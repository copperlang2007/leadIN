// Integration test: multi-org tenant isolation on the marketplace
// lead query (storage.getLeads).
//
// The marketplace lists leads via storage.getLeads({ orgId }). The
// org-scoping branch (storage.ts) is the cross-tenant-leakage guard:
// an org must see ONLY its own leads plus globally-unowned (legacy)
// leads — never another org's leads. A regression here is a data
// breach (org A's purchased-but-unsold inventory, consumer PII)
// leaking to org B, so it's worth pinning against a real DB where
// the SQL actually runs.
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { LIVE, seedOrg, seedUser, seedLead, freshId, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { users, vendors, leads } from "@shared/schema";
import { storage } from "../storage";

describe.skipIf(!LIVE)("multi-org tenant isolation (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("getLeads(orgId=A) returns A's leads + unowned, never B's", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();

    const leadA = await seedLead({ orgId: orgA });
    const leadB = await seedLead({ orgId: orgB });
    const leadUnowned = await seedLead({ orgId: null });

    const idsForA = (await storage.getLeads({ orgId: orgA })).map((l) => l.id);

    // A sees its own lead and the unowned/global lead...
    expect(idsForA).toContain(leadA);
    expect(idsForA).toContain(leadUnowned);
    // ...but MUST NOT see org B's lead. This is the breach guard.
    expect(idsForA).not.toContain(leadB);
  });

  it("the scoping is symmetric — B sees B + unowned, never A's", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();

    const leadA = await seedLead({ orgId: orgA });
    const leadB = await seedLead({ orgId: orgB });
    const leadUnowned = await seedLead({ orgId: null });

    const idsForB = (await storage.getLeads({ orgId: orgB })).map((l) => l.id);

    expect(idsForB).toContain(leadB);
    expect(idsForB).toContain(leadUnowned);
    expect(idsForB).not.toContain(leadA);
  });

  it("getLeads(orgId=null) returns ONLY unowned leads, no org-owned ones", async () => {
    const orgA = await seedOrg();
    const leadA = await seedLead({ orgId: orgA });
    const leadUnowned = await seedLead({ orgId: null });

    const idsForNull = (await storage.getLeads({ orgId: null })).map((l) => l.id);

    expect(idsForNull).toContain(leadUnowned);
    // A null-org (no active org) caller must not see any org's owned leads.
    expect(idsForNull).not.toContain(leadA);
  });

  it("omitting orgId does NOT scope (admin/global view sees everything)", async () => {
    // The org filter only applies when orgId is provided. An unscoped
    // call (e.g. the admin lead table) sees both orgs' leads — pinned
    // so a future change can't accidentally make the admin view leak-
    // proof in a way that hides real inventory from operators.
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const leadA = await seedLead({ orgId: orgA });
    const leadB = await seedLead({ orgId: orgB });

    const allIds = (await storage.getLeads()).map((l) => l.id);
    expect(allIds).toContain(leadA);
    expect(allIds).toContain(leadB);
  });

  // Vendor trust stats are DELIBERATELY marketplace-global, not org-scoped: a
  // vendor is a single marketplace entity (the `vendors` table has no orgId),
  // and its reliability is a shared reputation — two orgs buying from the same
  // vendor SHOULD see the same trust signal. getVendorTrustStats therefore
  // aggregates a vendor's sales/disputes across every org, and the route
  // exposes it to any authenticated buyer (aggregate counts only, no PII, no
  // per-org breakdown). This pins that intended cross-tenant aggregation so a
  // future change in either direction is caught. If org-scoping is ever a
  // requirement, this test is the deliberate line that must change with it.
  it("getVendorTrustStats aggregates a vendor's signal across orgs (intended, aggregate-only)", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const buyerA = await seedUser({ orgId: orgA });
    const buyerB = await seedUser({ orgId: orgB });
    await db.update(users).set({ balance: "1000.00" }).where(eq(users.id, buyerA));
    await db.update(users).set({ balance: "1000.00" }).where(eq(users.id, buyerB));

    // One vendor, one lead in each org, each purchased by that org's buyer.
    const [vendor] = await db
      .insert(vendors)
      .values({ name: `vendor-${freshId("v")}` })
      .returning({ id: vendors.id });
    const mkLead = async (orgId: string) => {
      const [lead] = await db
        .insert(leads)
        .values({
          vendorId: vendor.id,
          orgId,
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
    };
    await storage.purchaseLead(await mkLead(orgA), buyerA);
    await storage.purchaseLead(await mkLead(orgB), buyerB);

    // The aggregate spans BOTH orgs: soldCount is 2, not 1 — the caller's org
    // does not scope the signal. This is the documented, intended contract.
    const stats = await storage.getVendorTrustStats([vendor.id]);
    expect(stats[vendor.id].soldCount).toBe(2);
  });
});
