// Integration test: atomic multi-lead purchase (storage.purchaseLeads) — the
// Bulk Buy money path.
//
// purchaseLeads buys N leads in ONE transaction with a SINGLE wallet debit, or
// nothing at all. The invariants below (all-or-nothing rollback, no partial
// charge, no double-sell under concurrency) can only be verified against a
// real Postgres with row locks + a numeric balance column.
//
// What we pin:
//   - happy path: combined debit, every lead sold, one completed order each.
//   - insufficient balance: throws, NOTHING changes (full rollback).
//   - one already-sold lead: the WHOLE batch rolls back (no partial purchase).
//   - duplicate ids collapse to one purchase each.
//   - concurrency: two overlapping batches — the shared lead sells once and
//     the losing batch buys nothing (atomicity holds under contention).
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { LIVE, seedUser, seedLead, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { storage } from "../storage";
import { users, leads, orders } from "@shared/schema";

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
async function orderCount(leadId: number): Promise<number> {
  const rows = await db.select().from(orders).where(eq(orders.leadId, leadId));
  return rows.length;
}

describe.skipIf(!LIVE)("bulk lead purchase (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("debits the combined price once and marks every lead sold", async () => {
    const userId = await seedUser();
    await setBalance(userId, "100.00");
    const ids = [await seedLead(), await seedLead(), await seedLead()]; // $10 each

    const result = await storage.purchaseLeads(ids, userId);

    expect(result).toHaveLength(3);
    expect(await getBalance(userId)).toBe(70); // 100 - 3*10
    for (const id of ids) {
      expect(await isSold(id)).toBe(true);
      expect(await orderCount(id)).toBe(1);
    }
    expect(result.every((o) => o.status === "completed")).toBe(true);
  });

  it("rejects an unaffordable batch and rolls everything back", async () => {
    const userId = await seedUser();
    await setBalance(userId, "25.00"); // < 3 * $10
    const ids = [await seedLead(), await seedLead(), await seedLead()];

    await expect(storage.purchaseLeads(ids, userId)).rejects.toThrow(/insufficient/i);

    // Nothing moved: balance intact, no lead sold, no orders.
    expect(await getBalance(userId)).toBe(25);
    for (const id of ids) {
      expect(await isSold(id)).toBe(false);
      expect(await orderCount(id)).toBe(0);
    }
  });

  it("rolls back the WHOLE batch if any lead is already sold (no partial buy)", async () => {
    const buyer = await seedUser();
    const other = await seedUser();
    await setBalance(buyer, "100.00");
    await setBalance(other, "100.00");
    const [a, b, c] = [await seedLead(), await seedLead(), await seedLead()];

    // Someone else buys the middle lead first.
    await storage.purchaseLead(b, other);

    await expect(storage.purchaseLeads([a, b, c], buyer)).rejects.toThrow(/already sold/i);

    // The batch bought NOTHING — a and c are untouched, buyer not charged.
    expect(await getBalance(buyer)).toBe(100);
    expect(await isSold(a)).toBe(false);
    expect(await isSold(c)).toBe(false);
    expect(await orderCount(a)).toBe(0);
    expect(await orderCount(c)).toBe(0);
  });

  it("collapses duplicate ids to one purchase each", async () => {
    const userId = await seedUser();
    await setBalance(userId, "100.00");
    const a = await seedLead();
    const b = await seedLead();

    const result = await storage.purchaseLeads([a, a, b, b, a], userId);

    expect(result).toHaveLength(2); // deduped to {a, b}
    expect(await getBalance(userId)).toBe(80); // charged 2 * $10, not 5
    expect(await orderCount(a)).toBe(1);
    expect(await orderCount(b)).toBe(1);
  });

  it("concurrency: two overlapping batches — the shared lead sells exactly once", async () => {
    const buyer1 = await seedUser();
    const buyer2 = await seedUser();
    await setBalance(buyer1, "100.00");
    await setBalance(buyer2, "100.00");
    const [a, shared, c] = [await seedLead(), await seedLead(), await seedLead()];

    // Both batches want `shared`; all-or-nothing means the loser buys nothing.
    const results = await Promise.allSettled([
      storage.purchaseLeads([a, shared], buyer1),
      storage.purchaseLeads([shared, c], buyer2),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The shared lead sold exactly once.
    expect(await isSold(shared)).toBe(true);
    expect(await orderCount(shared)).toBe(1);

    // The winner bought both of its leads; the loser bought neither of its
    // non-shared leads (full rollback).
    const winnerBoughtA = await isSold(a);
    const winnerBoughtC = await isSold(c);
    // Exactly one of the two exclusive leads (a for buyer1, c for buyer2) sold.
    expect([winnerBoughtA, winnerBoughtC].filter(Boolean)).toHaveLength(1);

    // Exactly one buyer was charged $20; the other is untouched.
    const b1 = await getBalance(buyer1);
    const b2 = await getBalance(buyer2);
    expect([b1, b2].filter((b) => b === 80)).toHaveLength(1);
    expect([b1, b2].filter((b) => b === 100)).toHaveLength(1);
  });
});
