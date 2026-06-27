// Live-connect billing — bill leads the way a traditional live-transfer lead
// company does: the buyer is charged only when a call is actually CONNECTED
// LIVE to their agent AND the connection clears a quality bar (minimum talk
// time + detected intent + consent on file). No connect, no charge. This is
// the "fair shake" the platform promises: buyers stop paying for voicemails,
// hangups, and junk, and only pay when a real, interested consumer is on the
// line.
//
// The decision is a pure function over a connect event + a policy, so it is
// fully unit-testable and auditable. Idempotency (never double-billing the same
// connect) is enforced here via an `alreadyBilled` flag the caller derives from
// a persisted billing-key; the persistence itself lives in storage.

import { priceLead, type PricingFactors, type PriceBreakdown } from "./intentPricing";

export interface ConnectEvent {
  /** Stable id for this connect (call SID) — the idempotency key. */
  connectId: string;
  leadId: number;
  buyerId: string;
  /** Did the buyer's agent actually pick up (vs voicemail/no-answer)? */
  agentAnswered: boolean;
  /** Seconds of two-way talk time on the connected call. */
  talkSeconds: number;
  /** Detected purchase-intent 0..100. */
  intentScore: number;
  /** TCPA consent on file for this consumer. */
  consentOnFile: boolean;
  /** True if this connectId was already settled (prevents double charge). */
  alreadyBilled?: boolean;
}

export interface BillingPolicy {
  /** Minimum two-way talk seconds to count as a billable connect. */
  minTalkSeconds: number;
  /** Minimum intent score to count as a billable connect. */
  minIntentScore: number;
  /** Require TCPA consent on file before billing. */
  requireConsent: boolean;
}

// Industry-typical live-transfer qualification: ~90s of talk time, real intent,
// consent mandatory.
export const DEFAULT_POLICY: BillingPolicy = {
  minTalkSeconds: 90,
  minIntentScore: 40,
  requireConsent: true,
};

export interface BillingDecision {
  billable: boolean;
  /** Human-readable summary for the buyer-facing receipt/dispute trail. */
  reason: string;
  /** Machine-readable codes for every gate that failed (empty when billable). */
  failedGates: string[];
}

/**
 * Decide whether a live connect is billable. Pure & deterministic.
 */
export function decideLiveConnectBilling(
  event: ConnectEvent,
  policy: BillingPolicy = DEFAULT_POLICY,
): BillingDecision {
  const failedGates: string[] = [];

  if (event.alreadyBilled) failedGates.push("already_billed");
  if (!event.agentAnswered) failedGates.push("no_live_answer");
  if (event.talkSeconds < policy.minTalkSeconds) failedGates.push("talk_time_below_min");
  if (event.intentScore < policy.minIntentScore) failedGates.push("intent_below_min");
  if (policy.requireConsent && !event.consentOnFile) failedGates.push("no_consent");

  const billable = failedGates.length === 0;
  const reason = billable
    ? `Billable live connect: agent answered, ${event.talkSeconds}s talk time, intent ${event.intentScore}.`
    : `Not billed (${failedGates.join(", ")}).`;

  return { billable, reason, failedGates };
}

export interface SettlementResult {
  decision: BillingDecision;
  /** Amount to charge the buyer (USD string). "0.00" when not billable. */
  amount: string;
  /** Full price decomposition when billable, else null. */
  pricing: PriceBreakdown | null;
}

/**
 * Decide + price a live connect in one call. When billable, the amount is the
 * dynamic intent price; otherwise zero.
 */
export function settleLiveConnect(
  event: ConnectEvent,
  factors: PricingFactors,
  policy: BillingPolicy = DEFAULT_POLICY,
): SettlementResult {
  const decision = decideLiveConnectBilling(event, policy);
  if (!decision.billable) {
    return { decision, amount: "0.00", pricing: null };
  }
  const pricing = priceLead(factors);
  return { decision, amount: pricing.price, pricing };
}
