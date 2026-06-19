// Wave 7 (T8) — Real-time DNC gate at dial time.
//
// The nightly recheck (server/dncRecheck.ts) keeps `lead.dncFlagged` fresh
// once a day, but a phone can be added to the DNC registry at any moment.
// Right before the dialer places a call (POST /api/dialer/call) we re-run
// the DNC check so we never dial a number that is currently on the list.
//
// Public surface:
//   gateCallAgainstDnc(leadId, actorUserId?) → { allowed, reason? }
//
// Behaviour:
//   1. Load the lead. Missing lead → not allowed.
//   2. Missing phone → not allowed (can't dial what you don't have).
//   3. Run `checkDnc(lead.consumerPhone)`.
//   4. Persist the result on the lead (dncFlagged + dncCheckedAt).
//   5. If flagged, write an admin_audit_log row (`dial.blocked_dnc`) and
//      return { allowed: false, reason: "..." }.
//   6. Otherwise return { allowed: true }.
//
// The gate is idempotent: calling it twice for the same lead just re-runs
// the check and re-writes the same fields. Audit rows are append-only, so
// a repeat block will produce a second row — that's the intended trail.
//
// All side effects (storage, dnc check, audit) are injected via deps so the
// tests can drive the gate without a DB / vendor.

import { storage as defaultStorage } from "./storage";
import { checkDnc as defaultCheckDnc } from "./dncCompliance";
import { recordAudit as defaultRecordAudit } from "./audit";

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

interface LeadLike {
  id: number;
  consumerPhone: string | null;
  dncFlagged: boolean | null;
}

export interface GateDeps {
  getLead: (id: number) => Promise<LeadLike | undefined>;
  setLeadDncStatus: (leadId: number, flagged: boolean) => Promise<void>;
  checkDnc: (phone: string | null | undefined) => Promise<{
    flagged: boolean;
    source: string;
    reason?: string;
  }>;
  recordAudit: (input: {
    actorUserId: string;
    action: string;
    targetKind?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) => Promise<void>;
}

function defaultDeps(): GateDeps {
  return {
    getLead: (id) => defaultStorage.getLead(id),
    setLeadDncStatus: (id, flagged) => defaultStorage.setLeadDncStatus(id, flagged),
    checkDnc: defaultCheckDnc,
    recordAudit: defaultRecordAudit,
  };
}

/**
 * Gate a dial against the live DNC list. Always persists the latest
 * dncFlagged + dncCheckedAt on the lead. Returns `{ allowed: false }`
 * with a human-readable reason when the call must be blocked.
 *
 * @param leadId        The lead being dialled.
 * @param actorUserId   Who initiated the dial (for the audit trail). Defaults
 *                      to "system" if the caller doesn't have a user handle.
 * @param overrideDeps  Test-only injection point.
 */
export async function gateCallAgainstDnc(
  leadId: number,
  actorUserId: string = "system",
  overrideDeps?: Partial<GateDeps>,
): Promise<GateResult> {
  const deps: GateDeps = { ...defaultDeps(), ...(overrideDeps ?? {}) };

  const lead = await deps.getLead(leadId);
  if (!lead) {
    return { allowed: false, reason: "lead not found" };
  }

  if (!lead.consumerPhone) {
    return { allowed: false, reason: "lead has no phone on file" };
  }

  const result = await deps.checkDnc(lead.consumerPhone);

  // Persist the freshest answer EXCEPT when the vendor lookup errored.
  // checkDnc returns flagged=true defensively on vendor-error so this
  // call still gets blocked; but writing that flag to the lead row
  // would mark the lead as DNC-listed across the whole platform on the
  // strength of a single failed vendor request. Skip the persist on
  // vendor-error so the nightly recheck (with a healthy vendor) is
  // what writes the durable flag.
  if (result.source !== "vendor-error") {
    await deps.setLeadDncStatus(leadId, result.flagged);
  }

  if (result.flagged) {
    // Audit the block. recordAudit never throws, but we still await so the
    // row lands before the route returns 403 to the agent.
    await deps.recordAudit({
      actorUserId,
      action: "dial.blocked_dnc",
      targetKind: "lead",
      targetId: String(leadId),
      metadata: {
        leadId,
        source: result.source,
        reason: result.reason ?? null,
      },
    });
    return {
      allowed: false,
      reason: result.reason || "phone is on DNC list",
    };
  }

  return { allowed: true };
}
