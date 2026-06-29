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
import { LIVE, seedOrg, seedLead, assertDbReachable } from "./setup.js";
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
});
