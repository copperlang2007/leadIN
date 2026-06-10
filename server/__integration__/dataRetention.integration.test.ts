// Integration test: data retention sweep.
//
// Verifies that runDataRetentionSweep against a real DB:
//   - nulls out PII columns on leads older than the policy's leadPiiDays
//   - leaves fresh leads alone
//   - writes one audit row per org with scrubbed leads
//   - updates policy.lastSweepAt
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { LIVE, seedOrg, seedLead, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { leads, piiRetentionPolicies, adminAuditLog } from "@shared/schema";
import { runDataRetentionSweep } from "../dataRetention";

describe.skipIf(!LIVE)("data retention sweep (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("scrubs stale lead PII and leaves fresh leads intact", async () => {
    const orgId = await seedOrg();

    // Stale lead — created 400 days ago, beyond the default 365-day window.
    const staleAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const staleLeadId = await seedLead({ orgId, createdAt: staleAt });

    // Fresh lead — created today.
    const freshLeadId = await seedLead({ orgId });

    // Insert the retention policy (365 days by default).
    await db.insert(piiRetentionPolicies).values({
      orgId,
      leadPiiDays: 365,
      recordingDays: 180,
      transcriptDays: 365,
      autoDeleteEnabled: true,
    });

    const result = await runDataRetentionSweep();
    expect(result.policiesEvaluated).toBeGreaterThanOrEqual(1);
    expect(result.leadsScrubbed).toBeGreaterThanOrEqual(1);

    const [staleAfter] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, staleLeadId));
    expect(staleAfter.consumerName).toBeNull();
    expect(staleAfter.consumerPhone).toBeNull();
    expect(staleAfter.consumerEmail).toBeNull();
    expect(staleAfter.consumerAddress).toBeNull();

    const [freshAfter] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, freshLeadId));
    expect(freshAfter.consumerName).not.toBeNull();
    expect(freshAfter.consumerPhone).not.toBeNull();

    // Audit row landed for this org.
    const audits = await db
      .select()
      .from(adminAuditLog)
      .where(
        and(
          eq(adminAuditLog.orgId, orgId),
          eq(adminAuditLog.action, "data_retention.lead_pii_scrubbed"),
        ),
      );
    expect(audits.length).toBeGreaterThanOrEqual(1);

    // Policy's lastSweepAt bumped.
    const [policy] = await db
      .select()
      .from(piiRetentionPolicies)
      .where(eq(piiRetentionPolicies.orgId, orgId));
    expect(policy.lastSweepAt).not.toBeNull();
  });

  it("is a no-op when autoDeleteEnabled is false", async () => {
    const orgId = await seedOrg();
    const staleAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const leadId = await seedLead({ orgId, createdAt: staleAt });

    await db.insert(piiRetentionPolicies).values({
      orgId,
      leadPiiDays: 365,
      autoDeleteEnabled: false,
    });

    await runDataRetentionSweep();

    const [after] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, leadId));
    expect(after.consumerName).not.toBeNull();
  });
});
