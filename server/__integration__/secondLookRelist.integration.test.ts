// Integration test: Second-Look Re-list (storage.repriceAgingLeads) — the
// aging-inventory decay path.
//
// The repricer walks unsold, per-lead inventory older than the freshness
// window and decays `price` toward a floor while preserving the sticker value
// in `originalPrice`. The invariants below need a real Postgres: the numeric
// price column, the createdAt-based age filter, and — critically — that a
// re-listed lead's purchase then charges the DECAYED price (proving the money
// path reads the same column the repricer wrote).
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { LIVE, seedUser, seedLead, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { storage } from "../storage";
import { users, leads, orders } from "@shared/schema";

const H = 3_600_000; // ms per hour

async function setBalance(userId: string, balance: string): Promise<void> {
  await db.update(users).set({ balance }).where(eq(users.id, userId));
}
async function getBalance(userId: string): Promise<number> {
  const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId));
  return Number(u.balance);
}
async function getLeadRow(leadId: number) {
  const [l] = await db.select().from(leads).where(eq(leads.id, leadId));
  return l;
}

describe.skipIf(!LIVE)("second-look re-list (live DB)", () => {
  // Pin the decay knobs so the assertions are deterministic against the DB.
  const KNOBS = [
    "SECOND_LOOK_FRESH_HOURS",
    "SECOND_LOOK_FLOOR_PCT",
    "SECOND_LOOK_MIN_PRICE",
    "SECOND_LOOK_MAX_PER_RUN",
  ];
  let saved: Record<string, string | undefined>;

  beforeAll(async () => {
    await assertDbReachable();
  });

  beforeEach(() => {
    saved = {};
    for (const k of KNOBS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.SECOND_LOOK_FRESH_HOURS = "24";
    process.env.SECOND_LOOK_FLOOR_PCT = "0.5";
  });
  afterEach(() => {
    for (const k of KNOBS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("decays an aged unsold lead to the floor and preserves the sticker price", async () => {
    // 100h old, default sticker $10.00 → tier 3 → 50% floor → $5.00.
    const leadId = await seedLead({ createdAt: new Date(Date.now() - 100 * H) });

    const result = await storage.repriceAgingLeads();
    expect(result.repriced).toBeGreaterThanOrEqual(1);

    const lead = await getLeadRow(leadId);
    expect(Number(lead.price)).toBe(5);
    expect(Number(lead.originalPrice)).toBe(10);
    expect(lead.secondLook).toBe(true);
    expect(lead.repricedAt).not.toBeNull();
  });

  it("leaves a still-fresh lead untouched", async () => {
    const leadId = await seedLead({ createdAt: new Date(Date.now() - 1 * H) });

    await storage.repriceAgingLeads();

    const lead = await getLeadRow(leadId);
    expect(Number(lead.price)).toBe(10);
    expect(lead.secondLook).toBe(false);
    expect(lead.originalPrice).toBeNull();
  });

  it("is idempotent — a second sweep does not move an already-decayed lead", async () => {
    const leadId = await seedLead({ createdAt: new Date(Date.now() - 100 * H) });

    await storage.repriceAgingLeads();
    const afterFirst = await getLeadRow(leadId);
    const repricedAt1 = afterFirst.repricedAt;

    await storage.repriceAgingLeads();
    const afterSecond = await getLeadRow(leadId);

    // Price is unchanged AND the row wasn't rewritten (repricedAt is stable),
    // proving computeReprice returned shouldReprice=false the second time.
    expect(Number(afterSecond.price)).toBe(5);
    expect(afterSecond.repricedAt?.getTime()).toBe(repricedAt1?.getTime());
  });

  it("does not touch removed inventory", async () => {
    const leadId = await seedLead({ createdAt: new Date(Date.now() - 100 * H) });
    await db.update(leads).set({ removed: true }).where(eq(leads.id, leadId));

    await storage.repriceAgingLeads();

    const lead = await getLeadRow(leadId);
    expect(Number(lead.price)).toBe(10);
    expect(lead.secondLook).toBe(false);
  });

  it("does not starve a newly-aged lead behind an at-floor backlog larger than the per-run cap", async () => {
    // Build a fully-decayed (at-floor) backlog, then verify a lead that just
    // crossed into tier 1 still reprices in the next sweep even though the
    // backlog exceeds SECOND_LOOK_MAX_PER_RUN — i.e. at-floor rows don't
    // monopolize the LIMIT budget (the reported starvation bug).
    process.env.SECOND_LOOK_MAX_PER_RUN = "100"; // decay the backlog first
    const backlog: number[] = [];
    for (let i = 0; i < 3; i++) {
      backlog.push(await seedLead({ createdAt: new Date(Date.now() - (100 + i) * H) }));
    }
    await storage.repriceAgingLeads();
    for (const id of backlog) expect(Number((await getLeadRow(id)).price)).toBe(5);

    // Now impose a tight per-run cap (2) that's smaller than the backlog (3),
    // and add a freshly-tier-1 lead (30h old, never repriced).
    process.env.SECOND_LOOK_MAX_PER_RUN = "2";
    const newlyAged = await seedLead({ createdAt: new Date(Date.now() - 30 * H) });

    await storage.repriceAgingLeads();

    // The at-floor backlog is excluded from candidacy, so the tight cap is
    // spent on the lead that can actually move.
    const lead = await getLeadRow(newlyAged);
    expect(lead.secondLook).toBe(true);
    expect(Number(lead.price)).toBe(8.5); // 15% off the $10 sticker (tier 1)
  });

  it("does not starve tier-1 leads behind a MID-TIER settled backlog over the cap", async () => {
    // Regression for the subtler starvation: a tier-2 SETTLED lead ($7 on a
    // $10 sticker) is a computeReprice no-op but sits ABOVE the floor, so a
    // floor-only exclusion would still let it consume budget. Verify the
    // age-tier-aware predicate excludes it too.
    process.env.SECOND_LOOK_MAX_PER_RUN = "100";
    const tier2: number[] = [];
    for (let i = 0; i < 3; i++) {
      tier2.push(await seedLead({ createdAt: new Date(Date.now() - (50 + i) * H) })); // tier 2
    }
    await storage.repriceAgingLeads();
    for (const id of tier2) expect(Number((await getLeadRow(id)).price)).toBe(7); // 30% off

    // Cap below the settled backlog; add a freshly-tier-1 lead.
    process.env.SECOND_LOOK_MAX_PER_RUN = "2";
    const newlyAged = await seedLead({ createdAt: new Date(Date.now() - 30 * H) });

    await storage.repriceAgingLeads();

    const lead = await getLeadRow(newlyAged);
    expect(lead.secondLook).toBe(true);
    expect(Number(lead.price)).toBe(8.5); // tier 1, not starved by the settled tier-2 rows
  });

  it("reprices a settled row at EXACTLY age = 3*fresh (boundary matches computeReprice)", async () => {
    // Settle a lead at tier 2 ($7), then sweep with now = createdAt + exactly
    // 72h. computeReprice classifies age==3*fresh as tier 3, so the SQL bands
    // (lte/gt) must agree and decay it to the floor rather than leaving it at $7.
    const created = new Date(Date.now() - 50 * H); // starts in tier 2
    const leadId = await seedLead({ createdAt: created });
    await storage.repriceAgingLeads();
    expect(Number((await getLeadRow(leadId)).price)).toBe(7);

    const exactly3Fresh = new Date(created.getTime() + 3 * 24 * H); // fresh=24
    await storage.repriceAgingLeads(exactly3Fresh);

    expect(Number((await getLeadRow(leadId)).price)).toBe(5); // tier-3 floor
  });

  it("freezes quarantined inventory: flagged / dncFlagged leads are not decayed", async () => {
    const flaggedId = await seedLead({ createdAt: new Date(Date.now() - 100 * H) });
    const dncId = await seedLead({ createdAt: new Date(Date.now() - 100 * H) });
    await db.update(leads).set({ flagged: true }).where(eq(leads.id, flaggedId));
    await db.update(leads).set({ dncFlagged: true }).where(eq(leads.id, dncId));

    await storage.repriceAgingLeads();

    for (const id of [flaggedId, dncId]) {
      const lead = await getLeadRow(id);
      expect(Number(lead.price)).toBe(10); // untouched sticker
      expect(lead.secondLook).toBe(false);
      expect(lead.originalPrice).toBeNull();
    }
  });

  it("money path: buying a re-listed lead charges the DECAYED price", async () => {
    const buyer = await seedUser();
    await setBalance(buyer, "100.00");
    const leadId = await seedLead({ createdAt: new Date(Date.now() - 100 * H) });

    await storage.repriceAgingLeads(); // → $5.00

    const order = await storage.purchaseLead(leadId, buyer);

    // Charged the decayed $5, not the $10 sticker.
    expect(await getBalance(buyer)).toBe(95);
    expect(Number(order.price)).toBe(5);

    const lead = await getLeadRow(leadId);
    expect(lead.sold).toBe(true);
    // Sticker price is still visible for "was $10" display.
    expect(Number(lead.originalPrice)).toBe(10);
  });
});
