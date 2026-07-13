// Integration test: Saved-Search Alerts (wishlist) against a real DB.
//
// Exercises storage.notifyMatchingSavedSearches end-to-end: it must create
// exactly one in-app notification per distinct owner whose ACTIVE saved
// search matches a newly-ingested lead, respecting tenant (org) scoping.
// A regression here means buyers silently stop getting the alerts they
// signed up for — or get spammed / cross-tenant leakage. Worth pinning
// against the real SQL (jsonb criteria, org null-OR-equals scoping).
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { LIVE, seedOrg, seedUser, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { leads, vendors, type Lead, type SavedSearchCriteria } from "@shared/schema";
import { storage } from "../storage";

// Insert a lead with explicit matchable attributes. seedLead only lets us
// vary orgId/createdAt, but matching needs type/state/price/mediscore/verified,
// so we insert directly.
async function insertLead(opts: {
  orgId?: string | null;
  type?: string;
  state?: string;
  price?: string;
  mediscore?: number;
  verified?: boolean;
}): Promise<Lead> {
  const [vendor] = await db
    .insert(vendors)
    .values({ name: `vendor-ss-${Date.now()}-${Math.random().toString(16).slice(2)}` })
    .returning({ id: vendors.id });
  const [lead] = await db
    .insert(leads)
    .values({
      vendorId: vendor.id,
      orgId: opts.orgId ?? null,
      type: opts.type ?? "Medicare Advantage",
      source: "test",
      exclusivity: "shared",
      price: opts.price ?? "25.00",
      consumerAge: 65,
      state: opts.state ?? "CA",
      zipCode: "90001",
      verified: opts.verified ?? false,
      mediscore: opts.mediscore ?? 0,
      consumerName: "John Doe",
      consumerPhone: "+15555550100",
      consumerEmail: "john@test.local",
      consumerAddress: "1 Main St",
      provenance: { stub: true },
    })
    .returning();
  return lead;
}

async function createSearch(opts: {
  userId: string;
  orgId?: string | null;
  criteria: SavedSearchCriteria;
  active?: boolean;
  name?: string;
}) {
  return storage.createSavedSearch({
    userId: opts.userId,
    orgId: opts.orgId ?? null,
    name: opts.name ?? "My alert",
    criteria: opts.criteria,
    ...(opts.active === undefined ? {} : { active: opts.active }),
  });
}

async function notifCountForLead(userId: string, leadId: number): Promise<number> {
  const notifs = await storage.getUserNotifications(userId);
  return notifs.filter((n) => n.message.includes(`lead #${leadId}`)).length;
}

describe.skipIf(!LIVE)("saved-search alerts (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("notifies the owner when a newly-ingested lead matches", async () => {
    const userId = await seedUser();
    await createSearch({
      userId,
      criteria: { types: ["Medicare Advantage"], states: ["CA"], maxPrice: 30 },
    });

    const lead = await insertLead({ type: "Medicare Advantage", state: "CA", price: "25.00" });
    await storage.notifyMatchingSavedSearches(lead);

    expect(await notifCountForLead(userId, lead.id)).toBe(1);
  });

  it("does not notify when the lead does not match", async () => {
    const userId = await seedUser();
    await createSearch({ userId, criteria: { states: ["TX"] } });

    const lead = await insertLead({ state: "CA" });
    await storage.notifyMatchingSavedSearches(lead);

    expect(await notifCountForLead(userId, lead.id)).toBe(0);
  });

  it("dedupes to a single notification when one user has two matching searches", async () => {
    const userId = await seedUser();
    await createSearch({ userId, criteria: { states: ["CA"] }, name: "CA leads" });
    await createSearch({ userId, criteria: { types: ["Medicare Advantage"] }, name: "MA leads" });

    const lead = await insertLead({ type: "Medicare Advantage", state: "CA" });
    await storage.notifyMatchingSavedSearches(lead);

    expect(await notifCountForLead(userId, lead.id)).toBe(1);
  });

  it("respects org scoping — a search in org B does not match an org-A lead", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const userB = await seedUser({ orgId: orgB });
    await createSearch({ userId: userB, orgId: orgB, criteria: { states: ["CA"] } });

    const leadA = await insertLead({ orgId: orgA, state: "CA" });
    await storage.notifyMatchingSavedSearches(leadA);

    expect(await notifCountForLead(userB, leadA.id)).toBe(0);
  });

  it("a global (orgId=null) search matches an org-scoped lead", async () => {
    const orgA = await seedOrg();
    const userGlobal = await seedUser();
    await createSearch({ userId: userGlobal, orgId: null, criteria: { states: ["CA"] } });

    const leadA = await insertLead({ orgId: orgA, state: "CA" });
    await storage.notifyMatchingSavedSearches(leadA);

    expect(await notifCountForLead(userGlobal, leadA.id)).toBe(1);
  });

  it("an org-scoped search matches a global (orgId=null) lead only when its own org is null", async () => {
    // A search scoped to org B should NOT match a global lead (orgId null),
    // because the scoping rule for a null-org lead is "search.orgId IS NULL".
    const orgB = await seedOrg();
    const userB = await seedUser({ orgId: orgB });
    await createSearch({ userId: userB, orgId: orgB, criteria: { states: ["CA"] } });

    const globalLead = await insertLead({ orgId: null, state: "CA" });
    await storage.notifyMatchingSavedSearches(globalLead);

    expect(await notifCountForLead(userB, globalLead.id)).toBe(0);
  });

  it("ignores inactive saved searches", async () => {
    const userId = await seedUser();
    await createSearch({ userId, criteria: { states: ["CA"] }, active: false });

    const lead = await insertLead({ state: "CA" });
    await storage.notifyMatchingSavedSearches(lead);

    expect(await notifCountForLead(userId, lead.id)).toBe(0);
  });

  it("matches on mediscore and verified filters", async () => {
    const userId = await seedUser();
    await createSearch({ userId, criteria: { minMediscore: 60, verifiedOnly: true } });

    const matching = await insertLead({ mediscore: 70, verified: true });
    await storage.notifyMatchingSavedSearches(matching);
    expect(await notifCountForLead(userId, matching.id)).toBe(1);

    const lowScore = await insertLead({ mediscore: 40, verified: true });
    await storage.notifyMatchingSavedSearches(lowScore);
    expect(await notifCountForLead(userId, lowScore.id)).toBe(0);
  });
});
