// Integration test: Agent Referrals (N2) — the invite-and-earn money path.
//
// A referrer shares a stable code. A new user redeems it; when that referred
// user makes their FIRST lead purchase, BOTH wallets are credited by exactly
// REFERRAL_REWARD_CENTS and the referral flips to 'rewarded' — exactly once,
// even under concurrent purchases. These invariants (transactional double-
// credit, status-guarded idempotency, FOR UPDATE serialisation) can only be
// verified against a real Postgres.
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { LIVE, seedUser, seedLead, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { storage } from "../storage";
import { users, referrals } from "@shared/schema";
import { REFERRAL_REWARD_CENTS, isValidReferralCode } from "../referrals";

async function setBalance(userId: string, balance: string): Promise<void> {
  await db.update(users).set({ balance }).where(eq(users.id, userId));
}
async function getBalanceCents(userId: string): Promise<number> {
  const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId));
  return Math.round(Number(u.balance) * 100);
}
async function getReferralByReferrer(referrerUserId: string) {
  const [row] = await db.select().from(referrals).where(eq(referrals.referrerUserId, referrerUserId));
  return row;
}

const REWARD = REFERRAL_REWARD_CENTS;

describe.skipIf(!LIVE)("agent referrals (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("getOrCreateReferralCode is stable and returns a valid code", async () => {
    const referrer = await seedUser();
    const a = await storage.getOrCreateReferralCode(referrer);
    const b = await storage.getOrCreateReferralCode(referrer);

    expect(isValidReferralCode(a.code)).toBe(true);
    expect(a.code).toBe(b.code); // stable across calls
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("pending");
    expect(a.rewardCents).toBe(REWARD);
  });

  it("redeem links referrer↔referred and marks the row 'redeemed'", async () => {
    const referrer = await seedUser();
    const referred = await seedUser();
    const { code } = await storage.getOrCreateReferralCode(referrer);

    const row = await storage.redeemReferralCode(code, referred);
    expect(row.referredUserId).toBe(referred);
    expect(row.status).toBe("redeemed");
    expect(row.redeemedAt).toBeInstanceOf(Date);
  });

  it("rejects self-referral", async () => {
    const referrer = await seedUser();
    const { code } = await storage.getOrCreateReferralCode(referrer);
    await expect(storage.redeemReferralCode(code, referrer)).rejects.toThrow(/your own referral code/i);
  });

  it("rejects an unknown code", async () => {
    const user = await seedUser();
    // Well-formed but non-existent.
    await expect(storage.redeemReferralCode("ZZZZ2345", user)).rejects.toThrow(/invalid referral code/i);
  });

  it("rejects a malformed code before touching the DB", async () => {
    const user = await seedUser();
    await expect(storage.redeemReferralCode("bad code!", user)).rejects.toThrow(/invalid referral code/i);
  });

  it("rejects a second redemption by the same user (one per user)", async () => {
    const referrerA = await seedUser();
    const referrerB = await seedUser();
    const referred = await seedUser();
    const codeA = (await storage.getOrCreateReferralCode(referrerA)).code;
    const codeB = (await storage.getOrCreateReferralCode(referrerB)).code;

    await storage.redeemReferralCode(codeA, referred);
    await expect(storage.redeemReferralCode(codeB, referred)).rejects.toThrow(/already redeemed/i);
  });

  it("rejects redeeming a code that someone else already claimed", async () => {
    const referrer = await seedUser();
    const first = await seedUser();
    const second = await seedUser();
    const { code } = await storage.getOrCreateReferralCode(referrer);

    await storage.redeemReferralCode(code, first);
    await expect(storage.redeemReferralCode(code, second)).rejects.toThrow(/already been redeemed/i);
  });

  it("first purchase credits BOTH wallets by exactly REFERRAL_REWARD_CENTS and sets 'rewarded'", async () => {
    const referrer = await seedUser();
    const referred = await seedUser();
    await setBalance(referrer, "0.00");
    await setBalance(referred, "100.00"); // funds the $10 lead
    const { code } = await storage.getOrCreateReferralCode(referrer);
    await storage.redeemReferralCode(code, referred);

    const refBefore = await getBalanceCents(referrer);
    const buyerBefore = await getBalanceCents(referred);

    await storage.purchaseLead(await seedLead(), referred);

    // Referrer gains the reward; referred gains the reward net of the $10 spend.
    expect(await getBalanceCents(referrer)).toBe(refBefore + REWARD);
    expect(await getBalanceCents(referred)).toBe(buyerBefore - 1000 + REWARD);

    const row = await getReferralByReferrer(referrer);
    expect(row.status).toBe("rewarded");
    expect(row.rewardedAt).toBeInstanceOf(Date);
  });

  it("a SECOND purchase does NOT re-reward (idempotent)", async () => {
    const referrer = await seedUser();
    const referred = await seedUser();
    await setBalance(referrer, "0.00");
    await setBalance(referred, "100.00");
    const { code } = await storage.getOrCreateReferralCode(referrer);
    await storage.redeemReferralCode(code, referred);

    await storage.purchaseLead(await seedLead(), referred); // rewards once
    const refAfterFirst = await getBalanceCents(referrer);
    expect(refAfterFirst).toBe(REWARD);

    await storage.purchaseLead(await seedLead(), referred); // must NOT re-reward
    expect(await getBalanceCents(referrer)).toBe(refAfterFirst); // unchanged

    const row = await getReferralByReferrer(referrer);
    expect(row.status).toBe("rewarded");
  });

  it("reward does not fire for a buyer who never redeemed a code", async () => {
    const buyer = await seedUser();
    await setBalance(buyer, "100.00");
    await storage.purchaseLead(await seedLead(), buyer); // no referral → no-op
    // Nothing to assert on a referral row; just confirm the purchase succeeded
    // and the buyer was only charged the lead price.
    expect(await getBalanceCents(buyer)).toBe(10000 - 1000);
  });

  it("two concurrent first-purchases reward exactly once", async () => {
    const referrer = await seedUser();
    const referred = await seedUser();
    await setBalance(referrer, "0.00");
    await setBalance(referred, "100.00");
    const { code } = await storage.getOrCreateReferralCode(referrer);
    await storage.redeemReferralCode(code, referred);

    const a = await seedLead();
    const b = await seedLead();

    // Both purchases succeed (buyer can afford both $10 leads); the referral
    // reward must be granted exactly once despite the race.
    const results = await Promise.allSettled([
      storage.purchaseLead(a, referred),
      storage.purchaseLead(b, referred),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);

    // Referrer credited exactly one reward, not two.
    expect(await getBalanceCents(referrer)).toBe(REWARD);

    const row = await getReferralByReferrer(referrer);
    expect(row.status).toBe("rewarded");
  });

  it("getReferralSummary reflects redeemed/rewarded counts", async () => {
    const referrer = await seedUser();
    const referred = await seedUser();
    await setBalance(referred, "100.00");
    const { code } = await storage.getOrCreateReferralCode(referrer);

    let summary = await storage.getReferralSummary(referrer);
    expect(summary.code).toBe(code);
    expect(summary.status).toBe("pending");
    expect(summary.redeemedCount).toBe(0);
    expect(summary.rewardedCount).toBe(0);

    await storage.redeemReferralCode(code, referred);
    summary = await storage.getReferralSummary(referrer);
    expect(summary.redeemedCount).toBe(1);
    expect(summary.rewardedCount).toBe(0);

    await storage.purchaseLead(await seedLead(), referred);
    summary = await storage.getReferralSummary(referrer);
    expect(summary.status).toBe("rewarded");
    expect(summary.rewardedCount).toBe(1);
  });
});
