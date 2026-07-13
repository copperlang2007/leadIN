// Vendor Trust Signals — pure scoring helper.
//
// Buyers can't judge lead quality before purchase. We surface a per-vendor
// trust signal (dispute rate over completed-sale volume) on each marketplace
// lead card. This module owns the pure math so the tier boundaries stay
// unit-testable without a live DB. Storage supplies the raw counts; the route
// and client only render what this returns.

export type VendorTrustTier = "new" | "excellent" | "good" | "watch";

export interface TrustSignalInput {
  /** Completed-sale volume for the vendor (join orders → leads, status "completed"). */
  soldCount: number;
  /** Approved disputes filed against the vendor's leads. */
  disputeCount: number;
}

export interface TrustSignal {
  /** disputeCount / soldCount, or null when there is no sales volume yet. */
  disputeRate: number | null;
  tier: VendorTrustTier;
}

/** Per-vendor stats returned by storage.getVendorTrustStats (counts + signal). */
export interface VendorTrustStats extends TrustSignal {
  soldCount: number;
  disputeCount: number;
}

// Tier thresholds, keyed off the dispute rate (approved disputes ÷ completed
// sales). A brand-new vendor with zero sales has no signal yet → "new".
//   • rate <  2%  → "excellent"  (industry-clean; buy with confidence)
//   • rate <  8%  → "good"       (normal marketplace noise)
//   • rate >= 8%  → "watch"      (elevated disputes; scrutinise before buying)
// Boundaries are half-open on the low side: exactly 2% is NOT excellent (it is
// "good"); exactly 8% is NOT good (it is "watch").
export const TRUST_EXCELLENT_MAX = 0.02;
export const TRUST_GOOD_MAX = 0.08;

/**
 * Compute a vendor's trust signal from raw counts. Pure — no I/O.
 *
 * Divide-by-zero is handled explicitly: soldCount === 0 yields a null rate and
 * the "new" tier, regardless of disputeCount (a vendor with no completed sales
 * has no meaningful rate). Negative or non-finite inputs are floored to 0 so a
 * malformed count can never produce a bogus tier.
 */
export function computeTrustSignal({ soldCount, disputeCount }: TrustSignalInput): TrustSignal {
  const sold = Number.isFinite(soldCount) && soldCount > 0 ? Math.floor(soldCount) : 0;
  const disputes = Number.isFinite(disputeCount) && disputeCount > 0 ? Math.floor(disputeCount) : 0;

  if (sold === 0) {
    return { disputeRate: null, tier: "new" };
  }

  const disputeRate = disputes / sold;

  let tier: VendorTrustTier;
  if (disputeRate < TRUST_EXCELLENT_MAX) {
    tier = "excellent";
  } else if (disputeRate < TRUST_GOOD_MAX) {
    tier = "good";
  } else {
    tier = "watch";
  }

  return { disputeRate, tier };
}
