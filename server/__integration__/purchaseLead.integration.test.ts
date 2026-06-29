// Integration test: lead purchase (storage.purchaseLead) — the
// money-critical debit path.
//
// purchaseLead runs inside a DB transaction with `SELECT ... FOR
// UPDATE` row locks on both the lead and the buyer's wallet. The
// invariants below can only be verified against a real Postgres
// (transactions, row locks, the numeric balance column); mocks can't
// model the concurrency guarantee at all.
//
// What we pin:
//   - happy path: balance debited by exactly the price, lead marked
//     sold to the buyer, an order row in "completed".
//   - insufficient balance: throws, NOTHING changes (rollback).
//   - already-sold: throws, no double charge.
//   - DOUBLE-SPEND: two concurrent purchases of the same lead — exactly
//     ONE succeeds, the buyer is charged ONCE, the lead sells ONCE.
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

describe.skipIf(!LIVE)("lead purchase debit (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("debits the exact price, marks the lead sold, and writes a completed order", async () => {
    const userId = await seedUser();
    await setBalance(userId, "100.00");
    const leadId = await seedLead(); // default price "10.00"

    const order = await storage.purchaseLead(leadId, userId);

    expect(await getBalance(userId)).toBe(90);
    expect(order.status).toBe("completed");
    expect(order.leadId).toBe(leadId);

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead.sold).toBe(true);
    expect(lead.purchasedBy).toBe(userId);
  });

  it("rejects an insufficient balance and rolls everything back", async () => {
    const userId = await seedUser();
    await setBalance(userId, "5.00"); // < $10 price
    const leadId = await seedLead();

    await expect(storage.purchaseLead(leadId, userId)).rejects.toThrow(/insufficient/i);

    // No debit, lead NOT sold — the transaction rolled back cleanly.
    expect(await getBalance(userId)).toBe(5);
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead.sold).toBe(false);
  });

  it("rejects buying an already-sold lead (no double charge)", async () => {
    const buyer1 = await seedUser();
    const buyer2 = await seedUser();
    await setBalance(buyer1, "100.00");
    await setBalance(buyer2, "100.00");
    const leadId = await seedLead();

    await storage.purchaseLead(leadId, buyer1);
    await expect(storage.purchaseLead(leadId, buyer2)).rejects.toThrow(/already sold/i);

    // buyer2 must not have been charged.
    expect(await getBalance(buyer2)).toBe(100);
  });

  it("double-spend: two concurrent purchases of one lead — exactly one wins", async () => {
    const buyer1 = await seedUser();
    const buyer2 = await seedUser();
    await setBalance(buyer1, "100.00");
    await setBalance(buyer2, "100.00");
    const leadId = await seedLead(); // price "10.00"

    // Fire both at once. The FOR UPDATE lock + sold check must serialize
    // them: one commits, the other sees sold=true and throws.
    const results = await Promise.allSettled([
      storage.purchaseLead(leadId, buyer1),
      storage.purchaseLead(leadId, buyer2),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The lead sold exactly once, and exactly one order row exists for it.
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead.sold).toBe(true);
    const orderRows = await db.select().from(orders).where(eq(orders.leadId, leadId));
    expect(orderRows).toHaveLength(1);

    // Exactly one buyer was charged $10; the other is untouched.
    const b1 = await getBalance(buyer1);
    const b2 = await getBalance(buyer2);
    expect([b1, b2].filter((b) => b === 90)).toHaveLength(1);
    expect([b1, b2].filter((b) => b === 100)).toHaveLength(1);
  });
});
