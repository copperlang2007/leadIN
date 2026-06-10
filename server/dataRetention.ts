// Data retention enforcer.
//
// Drives the per-org GDPR/CCPA timer recorded in `pii_retention_policies`.
// For every org that has `autoDeleteEnabled = true`, we nightly null out
// the PII columns on leads older than `leadPiiDays`. Recordings and
// transcripts are scoped out of this first cut on purpose — the policy
// table already carries thresholds for them, but the cross-table joins
// to find the right rows deserve their own PR.
//
// Design rules:
//   * The sweep MUST be idempotent. Running it twice in a row is a
//     no-op on already-scrubbed rows because nulls won't match the
//     "non-null" filter we use to count affected rows.
//   * Errors against one org's policy must not abort the whole sweep.
//     We log + audit per-org failures and keep going.
//   * Writes to admin_audit_log are best-effort; they must never block
//     the actual scrub.

import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { db as defaultDb } from "./db";
import { leads, piiRetentionPolicies } from "@shared/schema";
import { registerCron } from "./lib/cronRegistry";
import { recordAudit } from "./audit";
import { log } from "./logger";

export interface RetentionStore {
  select: typeof defaultDb.select;
  update: typeof defaultDb.update;
}

let storeRef: RetentionStore = defaultDb;

/** Test-only override. Returns a reset fn. */
export function __setRetentionStoreForTesting(store: RetentionStore): () => void {
  const prev = storeRef;
  storeRef = store;
  return () => {
    storeRef = prev;
  };
}

export interface RetentionSweepResult {
  policiesEvaluated: number;
  orgsScrubbed: number;
  leadsScrubbed: number;
}

function daysAgo(days: number, ref: Date = new Date()): Date {
  return new Date(ref.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Scrub PII off leads belonging to one org whose retention window has
 * elapsed. Returns the affected row count. We treat any non-null PII
 * column as "this row still has data to clear" so re-runs are no-ops.
 */
async function scrubOrgLeadPii(orgId: string, cutoff: Date): Promise<number> {
  const result = await storeRef
    .update(leads)
    .set({
      consumerName: null,
      consumerPhone: null,
      consumerEmail: null,
      consumerAddress: null,
    })
    .where(
      and(
        eq(leads.orgId, orgId),
        // Only touch leads older than the retention window. Use createdAt
        // as the anchor — assignedAt may be NULL on unassigned leads.
        lt(leads.createdAt, cutoff),
        // Skip rows that are already fully scrubbed.
        or(
          isNotNull(leads.consumerName),
          isNotNull(leads.consumerPhone),
          isNotNull(leads.consumerEmail),
          isNotNull(leads.consumerAddress),
        ),
      ),
    )
    .returning({ id: leads.id });
  return result.length;
}

export async function runDataRetentionSweep(now: Date = new Date()): Promise<RetentionSweepResult> {
  const policies = await storeRef
    .select()
    .from(piiRetentionPolicies)
    .where(eq(piiRetentionPolicies.autoDeleteEnabled, true));

  let orgsScrubbed = 0;
  let leadsScrubbed = 0;

  for (const policy of policies) {
    // Safety: a zero or negative retention window would scrub every lead
    // immediately. Refuse to touch anything and surface the misconfig.
    if (policy.leadPiiDays <= 0) {
      log.warn("[data-retention] refusing to sweep — leadPiiDays must be > 0", {
        orgId: policy.orgId,
        leadPiiDays: policy.leadPiiDays,
      });
      continue;
    }
    const cutoff = daysAgo(policy.leadPiiDays, now);
    try {
      const count = await scrubOrgLeadPii(policy.orgId, cutoff);
      if (count > 0) {
        orgsScrubbed += 1;
        leadsScrubbed += count;
        await recordAudit({
          // Null actor — the data retention cron has no user identity.
          // adminAuditLog.actor_user_id is nullable and FK-set-null on delete,
          // so this is the correct shape for system actions.
          actorUserId: null,
          orgId: policy.orgId,
          action: "data_retention.lead_pii_scrubbed",
          targetKind: "org",
          targetId: policy.orgId,
          metadata: { source: "system:data-retention", leadCount: count, cutoff: cutoff.toISOString() },
        }).catch(() => {
          /* recordAudit already swallows — this catch is defensive */
        });
      }
      await storeRef
        .update(piiRetentionPolicies)
        .set({ lastSweepAt: now })
        .where(eq(piiRetentionPolicies.id, policy.id));
    } catch (err) {
      // One org's failure must not stop the rest.
      log.error("[data-retention] sweep failed for org", {
        orgId: policy.orgId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    policiesEvaluated: policies.length,
    orgsScrubbed,
    leadsScrubbed,
  };
}

export function startDataRetentionCron(): void {
  if (process.env.FEATURE_DATA_RETENTION === "false") {
    log.info("[data-retention] disabled via FEATURE_DATA_RETENTION=false");
    return;
  }
  // 03:00 every day. Sits after smart-match-cycle-reset (02:00) and
  // dnc-recheck (02:30) so PII scrubbing happens once daily activity
  // is settled.
  registerCron({
    name: "data-retention-sweep",
    schedule: "0 3 * * *",
    fn: async () => {
      const result = await runDataRetentionSweep();
      log.info("[data-retention] sweep complete", { ...result });
    },
  });
}
