// Integration test: agent purchase streaks against a real Postgres.
//
// storage.getPurchaseStreak(userId) reads DISTINCT UTC purchase days from
// `orders` (status='completed', bounded window) and feeds them to the pure
// computeStreak helper. These tests insert orders with hand-picked createdAt
// days and assert the resulting current/best/lastPurchaseDay — verifying the
// SQL day-bucketing agrees with the helper's UTC boundary.
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { LIVE, seedUser, seedLead, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { orders } from "@shared/schema";
import { storage } from "../storage";

/** Midnight-anchored UTC Date `daysAgo` days before now. */
function utcDaysAgo(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0); // midday UTC so the day bucket is unambiguous
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

/** Insert a completed order for `buyer` dated `daysAgo` days ago (UTC). */
async function insertCompletedOrder(buyer: string, daysAgo: number, price = "10.00"): Promise<void> {
  const leadId = await seedLead();
  await db.insert(orders).values({
    userId: buyer,
    leadId,
    price,
    status: "completed",
    createdAt: utcDaysAgo(daysAgo),
  });
}

describe.skipIf(!LIVE)("purchase streaks (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("returns all-zero for a user with no orders", async () => {
    const buyer = await seedUser();
    expect(await storage.getPurchaseStreak(buyer)).toEqual({
      current: 0,
      best: 0,
      lastPurchaseDay: null,
    });
  });

  it("today + yesterday + two-days-ago → current 3", async () => {
    const buyer = await seedUser();
    await insertCompletedOrder(buyer, 0);
    await insertCompletedOrder(buyer, 1);
    await insertCompletedOrder(buyer, 2);

    const streak = await storage.getPurchaseStreak(buyer);
    expect(streak.current).toBe(3);
    expect(streak.best).toBe(3);
  });

  it("collapses multiple same-day purchases into a single streak day", async () => {
    const buyer = await seedUser();
    // Three buys today, two yesterday — DISTINCT day means current is 2, not 5.
    await insertCompletedOrder(buyer, 0);
    await insertCompletedOrder(buyer, 0);
    await insertCompletedOrder(buyer, 0);
    await insertCompletedOrder(buyer, 1);
    await insertCompletedOrder(buyer, 1);

    const streak = await storage.getPurchaseStreak(buyer);
    expect(streak.current).toBe(2);
    expect(streak.best).toBe(2);
  });

  it("a gap makes best greater than current", async () => {
    const buyer = await seedUser();
    // Historical run of 3 (days 10,11,12 ago), gap, live tail of 2 (today+yesterday).
    await insertCompletedOrder(buyer, 12);
    await insertCompletedOrder(buyer, 11);
    await insertCompletedOrder(buyer, 10);
    await insertCompletedOrder(buyer, 1);
    await insertCompletedOrder(buyer, 0);

    const streak = await storage.getPurchaseStreak(buyer);
    expect(streak.current).toBe(2);
    expect(streak.best).toBe(3);
    expect(streak.best).toBeGreaterThan(streak.current);
  });

  it("a streak that ended 2+ days ago is not current", async () => {
    const buyer = await seedUser();
    // Most recent purchase is 3 days ago → stale → current 0, best 2.
    await insertCompletedOrder(buyer, 4);
    await insertCompletedOrder(buyer, 3);

    const streak = await storage.getPurchaseStreak(buyer);
    expect(streak.current).toBe(0);
    expect(streak.best).toBe(2);
  });

  it("ignores non-completed orders when computing the streak", async () => {
    const buyer = await seedUser();
    // A completed buy today, plus a refunded order yesterday that must NOT count.
    await insertCompletedOrder(buyer, 0);
    const refundedLead = await seedLead();
    await db.insert(orders).values({
      userId: buyer,
      leadId: refundedLead,
      price: "10.00",
      status: "refunded",
      createdAt: utcDaysAgo(1),
    });

    const streak = await storage.getPurchaseStreak(buyer);
    // Only today's completed order counts → current 1, not 2.
    expect(streak.current).toBe(1);
    expect(streak.best).toBe(1);
  });
});
