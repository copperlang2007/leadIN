// Integration test: Vendor Trust Signals (getVendorTrustStats) against a real
// Postgres. We seed a vendor with several leads, purchase them (completed
// orders), file + approve a dispute on one, and assert the aggregate
// soldCount / disputeCount / disputeRate / tier. A second vendor has zero
// sales → tier "new".
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { LIVE, seedOrg, seedUser, freshId, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { users, vendors, leads } from "@shared/schema";
import { storage } from "../storage";

async function setBalance(userId: string, balance: string): Promise<void> {
  await db.update(users).set({ balance }).where(eq(users.id, userId));
}

/** Create a bare vendor row; returns its id. */
async function createVendor(): Promise<number> {
  const [vendor] = await db
    .insert(vendors)
    .values({ name: `vendor-${freshId("v")}` })
    .returning({ id: vendors.id });
  return vendor.id;
}

/** Create a lead owned by `vendorId`; returns the lead id. */
async function createLeadForVendor(vendorId: number): Promise<number> {
  const [lead] = await db
    .insert(leads)
    .values({
      vendorId,
      orgId: null,
      type: "Medicare Advantage",
      source: "test",
      exclusivity: "shared",
      price: "10.00",
      consumerAge: 65,
      state: "CA",
      zipCode: "90001",
      consumerName: "John Doe",
      consumerPhone: "+15555550100",
      consumerEmail: "john@test.local",
      consumerAddress: "1 Main St, Springfield",
      provenance: { stub: true },
    })
    .returning({ id: leads.id });
  return lead.id;
}

describe.skipIf(!LIVE)("vendor trust stats (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("aggregates soldCount, disputeCount, rate and tier for a vendor with an approved dispute", async () => {
    const org = await seedOrg();
    const buyer = await seedUser({ orgId: org });
    const resolver = await seedUser({ orgId: org });
    await setBalance(buyer, "1000.00");

    const vendor = await createVendor();
    // Four leads, all purchased → four completed orders.
    const leadIds = [
      await createLeadForVendor(vendor),
      await createLeadForVendor(vendor),
      await createLeadForVendor(vendor),
      await createLeadForVendor(vendor),
    ];
    const orderIds: number[] = [];
    for (const id of leadIds) {
      const order = await storage.purchaseLead(id, buyer);
      orderIds.push(order.id);
    }

    // File + approve a dispute on ONE order, with a PARTIAL refund so the order
    // stays "completed" (a full refund would flip it to "refunded" and drop it
    // from soldCount). soldCount stays 4, disputeCount becomes 1.
    const dispute = await storage.createDispute({
      orderId: orderIds[0],
      buyerUserId: buyer,
      reason: "not_as_described",
    });
    await storage.approveDispute(dispute.id, resolver, 500); // partial $5 of $10

    const stats = await storage.getVendorTrustStats([vendor]);
    const s = stats[vendor];
    expect(s).toBeDefined();
    expect(s.soldCount).toBe(4);
    expect(s.disputeCount).toBe(1);
    expect(s.disputeRate).toBeCloseTo(0.25, 10);
    expect(s.tier).toBe("watch");
  });

  it("keeps a fully-refunded order in the sold denominator", async () => {
    // A full refund flips the order to "refunded", but the sale still happened
    // and drew a dispute. It MUST stay in soldCount — otherwise a vendor whose
    // bad lead got fully refunded would read as a clean 1-sale/0-dispute vendor
    // (or a 0-sale "new" one) instead of surfacing the dispute.
    const org = await seedOrg();
    const buyer = await seedUser({ orgId: org });
    const resolver = await seedUser({ orgId: org });
    await setBalance(buyer, "1000.00");

    const vendor = await createVendor();
    const goodLead = await createLeadForVendor(vendor);
    const badLead = await createLeadForVendor(vendor);
    await storage.purchaseLead(goodLead, buyer);
    const badOrder = await storage.purchaseLead(badLead, buyer);

    // Full $10 refund on the bad order → status flips to "refunded".
    const dispute = await storage.createDispute({
      orderId: badOrder.id,
      buyerUserId: buyer,
      reason: "not_as_described",
    });
    await storage.approveDispute(dispute.id, resolver, 1000); // full $10 of $10

    const stats = await storage.getVendorTrustStats([vendor]);
    const s = stats[vendor];
    expect(s.soldCount).toBe(2); // both sales counted, refund included
    expect(s.disputeCount).toBe(1);
    expect(s.disputeRate).toBeCloseTo(0.5, 10);
    expect(s.tier).toBe("watch");
  });

  it("rates a vendor with sales and no disputes as excellent", async () => {
    const org = await seedOrg();
    const buyer = await seedUser({ orgId: org });
    await setBalance(buyer, "1000.00");

    const vendor = await createVendor();
    const leadId = await createLeadForVendor(vendor);
    await storage.purchaseLead(leadId, buyer);

    const stats = await storage.getVendorTrustStats([vendor]);
    const s = stats[vendor];
    expect(s.soldCount).toBe(1);
    expect(s.disputeCount).toBe(0);
    expect(s.disputeRate).toBe(0);
    expect(s.tier).toBe("excellent");
  });

  it("returns tier 'new' with null rate for a vendor that has leads but no sales", async () => {
    const vendor = await createVendor();
    await createLeadForVendor(vendor); // exists but never purchased

    const stats = await storage.getVendorTrustStats([vendor]);
    const s = stats[vendor];
    expect(s.soldCount).toBe(0);
    expect(s.disputeCount).toBe(0);
    expect(s.disputeRate).toBeNull();
    expect(s.tier).toBe("new");
  });

  it("returns a default 'new' entry for every requested vendorId, even unknown ones", async () => {
    const known = await createVendor();
    // A very large id that has no vendor/leads at all.
    const unknown = 2_000_000_000;

    const stats = await storage.getVendorTrustStats([known, unknown]);
    expect(stats[known]).toEqual({ soldCount: 0, disputeCount: 0, disputeRate: null, tier: "new" });
    expect(stats[unknown]).toEqual({ soldCount: 0, disputeCount: 0, disputeRate: null, tier: "new" });
  });

  it("caps the requested vendorIds and ignores non-positive ids", async () => {
    const vendor = await createVendor();
    // Non-positive / non-integer ids are filtered out; only `vendor` survives.
    const stats = await storage.getVendorTrustStats([vendor, 0, -5]);
    expect(Object.keys(stats)).toEqual([String(vendor)]);
    expect(stats[vendor].tier).toBe("new");
  });

  it("does not let two joins inflate each other's counts (COUNT DISTINCT)", async () => {
    // A single lead purchased once and disputed+approved once must still read
    // as soldCount 1 / disputeCount 1 — the orders×disputes join must not
    // multiply. Use a partial refund so the order stays completed.
    const org = await seedOrg();
    const buyer = await seedUser({ orgId: org });
    const resolver = await seedUser({ orgId: org });
    await setBalance(buyer, "1000.00");

    const vendor = await createVendor();
    const leadId = await createLeadForVendor(vendor);
    const order = await storage.purchaseLead(leadId, buyer);
    const dispute = await storage.createDispute({
      orderId: order.id,
      buyerUserId: buyer,
      reason: "duplicate",
    });
    await storage.approveDispute(dispute.id, resolver, 500);

    const stats = await storage.getVendorTrustStats([vendor]);
    const s = stats[vendor];
    expect(s.soldCount).toBe(1);
    expect(s.disputeCount).toBe(1);
    expect(s.disputeRate).toBe(1);
    expect(s.tier).toBe("watch");
  });
});
