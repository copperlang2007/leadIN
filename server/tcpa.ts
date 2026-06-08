// TCPA defense insurance — pure helpers for limit enforcement.
//
// The DB-bound policy lifecycle + claim filing/resolution live in
// `storage.ts`. This module owns the pure math that decides whether a
// resolver-supplied `amountPaidCents` is admissible:
//
//   * `clampClaimPayout` — clamps a per-claim payout to the per-claim limit.
//   * `wouldExceedAggregate` — checks aggregate limit across all paid claims.
//   * `computeAggregatePaidCents` — sums already-paid claims for a policy.
//
// Keeping these in their own module means tests can run without a live DB.
// `tcpa.test.ts` exercises every branch here.
//
// Default limits (from `shared/schema.ts`):
//   * per_claim_limit_cents:     2_500_000  ($25,000)
//   * aggregate_limit_cents:    10_000_000  ($100,000)
//
// Status machines:
//   policy:  active -> expired|cancelled
//   claim:   open   -> approved|denied  (approved carries amount_paid_cents)

export const DEFAULT_PER_CLAIM_LIMIT_CENTS = 2_500_000; // $25,000
export const DEFAULT_AGGREGATE_LIMIT_CENTS = 10_000_000; // $100,000

export type PolicyStatus = "active" | "expired" | "cancelled";
export type ClaimStatus = "open" | "approved" | "denied";
export type ResolveAction = "approved" | "denied";

export interface ClaimLike {
  status: string | ClaimStatus;
  amountPaidCents: number | null;
}

/**
 * Sum `amount_paid_cents` for all claims that already drew down the
 * aggregate (i.e. `approved` claims). `open` and `denied` claims do not
 * count against the aggregate.
 */
export function computeAggregatePaidCents(claims: ClaimLike[]): number {
  let total = 0;
  for (const c of claims) {
    if (c.status !== "approved") continue;
    const paid = c.amountPaidCents ?? 0;
    if (!Number.isFinite(paid) || paid <= 0) continue;
    total += Math.floor(paid);
  }
  return total;
}

/**
 * Clamp a requested payout to the per-claim limit. Negative / non-finite
 * values collapse to 0.
 */
export function clampClaimPayout(
  requestedCents: number,
  perClaimLimitCents: number,
): number {
  if (!Number.isFinite(requestedCents) || requestedCents <= 0) return 0;
  if (!Number.isFinite(perClaimLimitCents) || perClaimLimitCents <= 0) return 0;
  const r = Math.floor(requestedCents);
  const cap = Math.floor(perClaimLimitCents);
  return r > cap ? cap : r;
}

/**
 * Returns true if paying `proposedPayoutCents` on top of the already-paid
 * aggregate would breach the policy aggregate limit.
 */
export function wouldExceedAggregate(
  proposedPayoutCents: number,
  alreadyPaidAggregateCents: number,
  aggregateLimitCents: number,
): boolean {
  const proposed = Math.max(0, Math.floor(proposedPayoutCents || 0));
  const already = Math.max(0, Math.floor(alreadyPaidAggregateCents || 0));
  const cap = Math.max(0, Math.floor(aggregateLimitCents || 0));
  return already + proposed > cap;
}

/**
 * High-level validation for resolving a claim with `approved`. Throws on
 * invalid input; returns the final payout cents to write (after clamping).
 *
 * - Requires a positive `amountPaidCents`.
 * - Clamps to the per-claim limit.
 * - Refuses if the post-payment aggregate would exceed the policy cap.
 */
export function validateApprovedPayout(input: {
  amountPaidCents: number;
  perClaimLimitCents: number;
  aggregateLimitCents: number;
  alreadyPaidAggregateCents: number;
}): number {
  const { amountPaidCents, perClaimLimitCents, aggregateLimitCents, alreadyPaidAggregateCents } = input;
  if (!Number.isFinite(amountPaidCents) || amountPaidCents <= 0) {
    throw new Error("amountPaidCents must be a positive integer when approving");
  }
  const clamped = clampClaimPayout(amountPaidCents, perClaimLimitCents);
  if (clamped <= 0) {
    throw new Error("Per-claim limit is zero — cannot approve any payout");
  }
  if (wouldExceedAggregate(clamped, alreadyPaidAggregateCents, aggregateLimitCents)) {
    throw new Error(
      `Approval would exceed aggregate limit (already paid ${alreadyPaidAggregateCents} of ${aggregateLimitCents})`,
    );
  }
  return clamped;
}
