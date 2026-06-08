// Wave 7 (T1) — Lead replacement: auto-detect bad-contact leads using
// call-log signals (K3 dialer) and DNC re-check, then auto-issue
// replacement credits without requiring a buyer-filed dispute.
//
// Design rules:
//   * The detection logic (`detectBadContact`) is pure: it takes call logs
//     plus an optional DNC flag and returns a verdict. No DB. No clock.
//     Tests can construct any shape they want.
//   * The eligibility + credit issuance logic uses a thin `ReplacementDeps`
//     facade so we can swap in mocks. The default uses the live `storage`
//     plus `recordAudit`.
//   * The credit amount is 50% of the order price (Apple trade-in pattern).
//     Conversion to cents is done with the same Decimal helper the dispute
//     module uses, so refund/credit math stays consistent.
//   * Idempotent: re-checking an order that already has a credit is a no-op
//     and returns `{ eligible: false, reason: "already_credited" }`.

import Decimal from "decimal.js";
import { eq, and, desc } from "drizzle-orm";
import {
  callLogs,
  leadTradeInCredits,
  type CallLog,
  type LeadTradeInCredit,
  type Order,
} from "@shared/schema";
import { db as defaultDb } from "./db";
import { storage as defaultStorage } from "./storage";
import { recordAudit as defaultRecordAudit } from "./audit";

// ──────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────

/** Number of unsuccessful call attempts that flips a lead to "bad contact". */
export const BAD_CONTACT_FAIL_THRESHOLD = 3;

/** Call statuses that count as a failed contact attempt. */
export const FAILED_CALL_STATUSES = new Set<string>([
  "no-answer",
  "busy",
  "failed",
]);

/** Min call logs required before we render a verdict. */
export const MIN_CALL_LOGS = 1;

/** Max age (days) an order can be to qualify for auto-replacement. */
export const REPLACEMENT_WINDOW_DAYS = 14;

/** Trade-in credit fraction of the original order price. */
export const CREDIT_FRACTION = 0.5;

/** Credit expiration window (days). */
export const CREDIT_EXPIRY_DAYS = 90;

// ──────────────────────────────────────────────────────
// Pure detection helper
// ──────────────────────────────────────────────────────

export type BadContactVerdict = "bad" | "ok" | "insufficient";

/**
 * A subset of CallLog we need to make a verdict. Tests pass plain objects.
 */
export interface CallLogLike {
  status: string;
  // Optional DNC recheck flag carried alongside a call attempt; many
  // dialers stamp this on the call row when the consumer phone is flagged
  // by the nightly recheck right before dial-out.
  dncFlagged?: boolean | null;
}

export interface DetectBadContactOptions {
  /** Did the most recent DNC re-check flip the lead's phone to flagged? */
  dncFlagged?: boolean;
}

/**
 * Decide whether a lead's contact info is "bad" enough to warrant an
 * automatic replacement credit.
 *
 *   * "bad" — 3+ no-answer/busy/failed calls OR DNC-flagged re-check.
 *   * "ok"  — has 1+ completed call (consumer was reachable).
 *   * "insufficient" — not enough signal to decide (0 logs, only ringing/queued).
 *
 * The function is deliberately tolerant of unknown statuses: anything that
 * isn't "completed" or in `FAILED_CALL_STATUSES` is ignored when counting
 * failures, but also doesn't count as a success.
 */
export function detectBadContact(
  callLogs: readonly CallLogLike[],
  options: DetectBadContactOptions = {},
): BadContactVerdict {
  // DNC re-check trumps everything — a flagged number can't be called at all.
  if (options.dncFlagged) return "bad";

  if (!Array.isArray(callLogs) || callLogs.length < MIN_CALL_LOGS) {
    return "insufficient";
  }

  let completed = 0;
  let failed = 0;
  for (const c of callLogs) {
    if (c?.dncFlagged) return "bad";
    const s = (c?.status ?? "").toLowerCase();
    if (s === "completed") completed += 1;
    else if (FAILED_CALL_STATUSES.has(s)) failed += 1;
  }

  if (completed > 0) return "ok";
  if (failed >= BAD_CONTACT_FAIL_THRESHOLD) return "bad";
  return "insufficient";
}

/**
 * Trade-in credit in cents. Uses Decimal so it lines up with
 * priceStringToCents in disputes.ts and never drifts at the boundary.
 */
export function computeCreditCents(orderPrice: string | number, fraction = CREDIT_FRACTION): number {
  const price = new Decimal(orderPrice);
  if (!price.isFinite() || price.lessThanOrEqualTo(0)) return 0;
  return price
    .mul(100)
    .mul(fraction)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * Returns true if the order was placed within REPLACEMENT_WINDOW_DAYS.
 * `now` is injectable for tests.
 */
export function isWithinReplacementWindow(
  createdAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!createdAt) return false;
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return false;
  const ageMs = now.getTime() - d.getTime();
  const maxAgeMs = REPLACEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

// ──────────────────────────────────────────────────────
// Storage facade (injected for tests)
// ──────────────────────────────────────────────────────

export interface ReplacementDeps {
  getOrder: (orderId: number) => Promise<Order | undefined>;
  getCallLogsForOrder: (orderId: number) => Promise<CallLog[]>;
  getCreditForOrder: (orderId: number) => Promise<LeadTradeInCredit | undefined>;
  createTradeInCredit: (input: {
    orderId: number;
    agentUserId: string;
    creditCents: number;
    reason: string;
    expiresAt?: Date | null;
  }) => Promise<LeadTradeInCredit>;
  redeemTradeInCredit: (
    creditId: number,
    leadId: number,
  ) => Promise<LeadTradeInCredit>;
  recordAudit?: (input: {
    actorUserId: string;
    action: string;
    targetKind?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) => Promise<void> | void;
  now?: () => Date;
}

function defaultDeps(): ReplacementDeps {
  return {
    getOrder: (orderId) => defaultStorage.getOrderById(orderId),
    getCallLogsForOrder: (orderId) => getCallLogsForOrderImpl(orderId),
    getCreditForOrder: (orderId) => getCreditForOrderImpl(orderId),
    createTradeInCredit: (input) => createTradeInCreditImpl(input),
    redeemTradeInCredit: (creditId, leadId) => redeemTradeInCreditImpl(creditId, leadId),
    recordAudit: (input) =>
      defaultRecordAudit({
        actorUserId: input.actorUserId,
        action: input.action,
        targetKind: input.targetKind ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata ?? null,
      }),
    now: () => new Date(),
  };
}

// ──────────────────────────────────────────────────────
// Default DB implementations (used when storage facade isn't overridden)
// ──────────────────────────────────────────────────────

async function getCallLogsForOrderImpl(orderId: number): Promise<CallLog[]> {
  // Look up the order's lead, then fetch all call logs against it. We
  // intentionally don't filter by agent — replacement evaluates every
  // attempt made on this lead (any teammate, any retry).
  const order = await defaultStorage.getOrderById(orderId);
  if (!order) return [];
  return await defaultDb
    .select()
    .from(callLogs)
    .where(eq(callLogs.leadId, order.leadId))
    .orderBy(desc(callLogs.startedAt))
    .limit(100);
}

async function getCreditForOrderImpl(orderId: number): Promise<LeadTradeInCredit | undefined> {
  const [row] = await defaultDb
    .select()
    .from(leadTradeInCredits)
    .where(eq(leadTradeInCredits.orderId, orderId))
    .limit(1);
  return row;
}

async function createTradeInCreditImpl(input: {
  orderId: number;
  agentUserId: string;
  creditCents: number;
  reason: string;
  expiresAt?: Date | null;
}): Promise<LeadTradeInCredit> {
  const [row] = await defaultDb
    .insert(leadTradeInCredits)
    .values({
      orderId: input.orderId,
      agentUserId: input.agentUserId,
      creditCents: input.creditCents,
      reason: input.reason,
      status: "issued",
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  return row;
}

async function redeemTradeInCreditImpl(creditId: number, leadId: number): Promise<LeadTradeInCredit> {
  // We mark the credit redeemed atomically; the actual lead purchase
  // discount is applied by the route layer (deducts creditCents from
  // the wallet draw on purchaseLead).
  const [row] = await defaultDb
    .update(leadTradeInCredits)
    .set({ status: "redeemed", redeemedAt: new Date() })
    .where(
      and(
        eq(leadTradeInCredits.id, creditId),
        eq(leadTradeInCredits.status, "issued"),
      ),
    )
    .returning();
  if (!row) {
    throw new Error("Credit not redeemable (not found, already redeemed, or expired)");
  }
  // Stash the leadId in audit metadata via the caller. The schema has no
  // dedicated redeemed_lead_id column, so we don't write one here.
  void leadId;
  return row;
}

// ──────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────

export interface ProposeResult {
  eligible: boolean;
  reason: string;
  creditCents?: number;
  verdict?: BadContactVerdict;
}

/**
 * Decide whether `orderId` qualifies for an auto-replacement credit.
 * Pure-ish: only reads. Does not mutate.
 */
export async function proposeReplacementCredit(
  orderId: number,
  deps: ReplacementDeps = defaultDeps(),
): Promise<ProposeResult> {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return { eligible: false, reason: "invalid_order_id" };
  }

  const order = await deps.getOrder(orderId);
  if (!order) return { eligible: false, reason: "order_not_found" };

  const existing = await deps.getCreditForOrder(orderId);
  if (existing) return { eligible: false, reason: "already_credited" };

  const now = (deps.now ?? (() => new Date()))();
  if (!isWithinReplacementWindow(order.createdAt, now)) {
    return { eligible: false, reason: "order_too_old" };
  }

  const logs = await deps.getCallLogsForOrder(orderId);
  const verdict = detectBadContact(logs);
  if (verdict !== "bad") {
    return { eligible: false, reason: `verdict_${verdict}`, verdict };
  }

  const creditCents = computeCreditCents(order.price);
  if (creditCents <= 0) {
    return { eligible: false, reason: "zero_credit", verdict };
  }

  return { eligible: true, reason: "bad_contact_detected", creditCents, verdict };
}

export interface AutoIssueResult {
  issued: boolean;
  reason: string;
  credit?: LeadTradeInCredit;
  creditCents?: number;
}

/**
 * Run the full auto-replacement pipeline: propose + (if eligible) issue
 * the trade-in credit. Idempotent — calling twice in a row returns
 * `{ issued: false, reason: "already_credited" }` on the second call.
 */
export async function autoIssueReplacement(
  orderId: number,
  deps: ReplacementDeps = defaultDeps(),
): Promise<AutoIssueResult> {
  const proposal = await proposeReplacementCredit(orderId, deps);
  if (!proposal.eligible || !proposal.creditCents) {
    return { issued: false, reason: proposal.reason, creditCents: proposal.creditCents };
  }

  const order = await deps.getOrder(orderId);
  // proposeReplacementCredit already guarded that order exists; narrow it again.
  if (!order || !order.userId) {
    return { issued: false, reason: "order_missing_user" };
  }

  const now = (deps.now ?? (() => new Date()))();
  const expiresAt = new Date(now.getTime() + CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const credit = await deps.createTradeInCredit({
    orderId,
    agentUserId: order.userId,
    creditCents: proposal.creditCents,
    reason: "bad_contact_auto",
    expiresAt,
  });

  if (deps.recordAudit) {
    try {
      await deps.recordAudit({
        actorUserId: "system",
        action: "tradein_credit.auto_issued",
        targetKind: "order",
        targetId: String(orderId),
        metadata: {
          creditId: credit.id,
          creditCents: proposal.creditCents,
          verdict: proposal.verdict,
        },
      });
    } catch (err) {
      // Audit failures must not roll back an issued credit.
      console.warn("[leadReplacement] audit failed:", err);
    }
  }

  return { issued: true, reason: proposal.reason, credit, creditCents: proposal.creditCents };
}

// ──────────────────────────────────────────────────────
// Batch helper — for the "50% of a batch is unreachable" trigger.
// ──────────────────────────────────────────────────────

/**
 * Given an array of {orderId, verdict} pairs, returns true when more
 * than half are "bad". The route layer uses this to decide whether
 * to auto-issue across an entire batch without per-order disputes.
 */
export function batchExceedsBadThreshold(
  results: { verdict: BadContactVerdict }[],
  thresholdPct = 0.5,
): boolean {
  if (results.length === 0) return false;
  const bad = results.filter(r => r.verdict === "bad").length;
  return bad / results.length > thresholdPct;
}
