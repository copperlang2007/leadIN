// Integration test: monthly Spend Caps (A2) enforced in the purchase path.
//
// An org owner/admin caps a member's monthly lead spend
// (orgMembers.monthlySpendCapCents). purchaseLead / purchaseLeads must reject a
// purchase that would push the member's total spend for the current calendar
// month over the cap — atomically (full rollback), counting only this month's
// orders, and race-safe (the buyer's FOR UPDATE lock serialises concurrent
// purchases). These invariants need a real Postgres.
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { LIVE, seedOrg, seedUser, seedLead, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { storage } from "../storage";
import { users, leads, orders, orgMembers } from "@shared/schema";

async function setBalance(userId: string, balance: string): Promise<void> {
  await db.update(users).set({ balance }).where(eq(users.id, userId));
}
async function getBalance(userId: string): Promise<number> {
  const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId));
  return Number(u.balance);
}
async function isSold(leadId: number): Promise<boolean> {
  const [l] = await db.select({ sold: leads.sold }).from(leads).where(eq(leads.id, leadId));
  return l.sold;
}

/** A buyer who is a capped member of `orgId`, with a funded wallet. */
async function seedCappedBuyer(orgId: string, capCents: number | null, balance = "1000.00"): Promise<string> {
  const userId = await seedUser({ orgId }); // activeOrgId = orgId
  await db.insert(orgMembers).values({ orgId, userId, role: "agent", monthlySpendCapCents: capCents });
  await setBalance(userId, balance);
  return userId;
}

describe.skipIf(!LIVE)("monthly spend caps (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("allows a batch that stays within the cap", async () => {
    const org = await seedOrg();
    const buyer = await seedCappedBuyer(org, 5000); // $50 cap
    const ids = [await seedLead(), await seedLead(), await seedLead()]; // $30

    await storage.purchaseLeads(ids, buyer);

    expect(await getBalance(buyer)).toBe(970); // 1000 - 30
    for (const id of ids) expect(await isSold(id)).toBe(true);
  });

  it("rejects a batch that would exceed the cap and rolls everything back", async () => {
    const org = await seedOrg();
    const buyer = await seedCappedBuyer(org, 2500); // $25 cap
    const ids = [await seedLead(), await seedLead(), await seedLead()]; // $30 > $25

    await expect(storage.purchaseLeads(ids, buyer)).rejects.toThrow(/spend cap/i);

    // Nothing moved — the cap fired before any debit/sale.
    expect(await getBalance(buyer)).toBe(1000);
    for (const id of ids) expect(await isSold(id)).toBe(false);
  });

  it("rejects a single purchase once the month's prior spend meets the cap", async () => {
    const org = await seedOrg();
    const buyer = await seedCappedBuyer(org, 2500); // $25 cap
    // Spend $20 this month via two real purchases (uncapped headroom so far).
    await storage.purchaseLead(await seedLead(), buyer);
    await storage.purchaseLead(await seedLead(), buyer);
    expect(await getBalance(buyer)).toBe(980); // spent $20

    // A third $10 lead would make $30 > $25 → rejected.
    const third = await seedLead();
    await expect(storage.purchaseLead(third, buyer)).rejects.toThrow(/spend cap/i);
    expect(await isSold(third)).toBe(false);
    expect(await getBalance(buyer)).toBe(980); // unchanged
  });

  it("counts only the CURRENT calendar month — prior-month spend doesn't apply", async () => {
    const org = await seedOrg();
    const buyer = await seedCappedBuyer(org, 2500); // $25 cap
    // A big order dated to last month must NOT count against this month's cap.
    const oldLead = await seedLead();
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    await db.insert(orders).values({
      userId: buyer,
      leadId: oldLead,
      orgId: org,
      price: "100.00",
      status: "completed",
      createdAt: lastMonth,
    });

    // With $0 counted this month, a $10 buy is well under the $25 cap.
    const fresh = await seedLead();
    await storage.purchaseLead(fresh, buyer);
    expect(await isSold(fresh)).toBe(true);
  });

  it("treats a null cap as uncapped", async () => {
    const org = await seedOrg();
    const buyer = await seedCappedBuyer(org, null); // uncapped
    const ids = [await seedLead(), await seedLead(), await seedLead(), await seedLead()];

    await storage.purchaseLeads(ids, buyer);
    for (const id of ids) expect(await isSold(id)).toBe(true);
  });

  it("does not cap a buyer with no active org membership", async () => {
    const buyer = await seedUser(); // activeOrgId null, no membership
    await setBalance(buyer, "1000.00");
    const ids = [await seedLead(), await seedLead(), await seedLead()];

    await storage.purchaseLeads(ids, buyer);
    for (const id of ids) expect(await isSold(id)).toBe(true);
  });

  it("get/set member cap round-trips; setting on a non-member reports false", async () => {
    const org = await seedOrg();
    const member = await seedCappedBuyer(org, null); // member, uncapped
    const stranger = await seedUser(); // not a member of org

    expect(await storage.getMemberSpendCap(org, member)).toBeNull();
    expect(await storage.setMemberSpendCap(org, member, 5000)).toBe(true);
    expect(await storage.getMemberSpendCap(org, member)).toBe(5000);
    expect(await storage.setMemberSpendCap(org, member, null)).toBe(true);
    expect(await storage.getMemberSpendCap(org, member)).toBeNull();

    // No membership row → no update happened.
    expect(await storage.setMemberSpendCap(org, stranger, 5000)).toBe(false);
  });

  it("race-safe: two concurrent purchases can't jointly exceed the cap", async () => {
    const org = await seedOrg();
    const buyer = await seedCappedBuyer(org, 1500); // $15 cap — fits ONE $10, not two
    const a = await seedLead();
    const b = await seedLead();

    const results = await Promise.allSettled([
      storage.purchaseLead(a, buyer),
      storage.purchaseLead(b, buyer),
    ]);

    // The FOR UPDATE lock serialises them: one commits ($10 <= $15), the other
    // sees $10 already spent and $10 more would be $20 > $15 → rejected.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect([await isSold(a), await isSold(b)].filter(Boolean)).toHaveLength(1);
    expect(await getBalance(buyer)).toBe(990); // charged exactly once
  });
});
