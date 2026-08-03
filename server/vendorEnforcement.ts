// Vendor trust enforcement — pure threshold logic, no I/O.
//
// vendorTrust.ts computes the *informational* trust badge buyers see.
// This module owns the *enforcement* side: mapping a vendor's windowed
// dispute record to an operational status that ingest and the marketplace
// actually act on. Storage supplies windowed counts; approveDispute/denyDispute
// trigger recomputes; ingestLeadForVendor and getLeads enforce the result.
//
// Design points:
//   • Windowed (90d), unlike the lifetime badge — a vendor who cleaned up
//     recovers as bad disputes age out, without an admin touching anything.
//   • Minimum-volume gate: no vendor is throttled or suspended off fewer than
//     ENFORCE_MIN_SALES windowed sales, so one unlucky dispute can't kill a
//     new vendor.
//   • Suspension threshold sits well above the "watch" badge (8%) so the
//     badge warns buyers long before the platform pulls the plug.

export type VendorStatus = "active" | "throttled" | "suspended";

/** Rolling window for enforcement stats, in days. */
export const ENFORCE_WINDOW_DAYS = 90;
/** Minimum windowed completed sales before enforcement can trigger. */
export const ENFORCE_MIN_SALES = 10;
/** Approved-dispute rate at/above which a vendor is throttled. */
export const THROTTLE_RATE = 0.08;
/** Approved-dispute rate at/above which a vendor is suspended. */
export const SUSPEND_RATE = 0.15;
/** Max leads a throttled vendor may ingest per UTC day. */
export const THROTTLED_DAILY_INGEST_CAP = 25;

export interface EnforcementInput {
  /** Completed sales of the vendor's leads inside the window. */
  soldCount: number;
  /** Approved disputes resolved inside the window. */
  disputeCount: number;
}

export interface EnforcementDecision {
  status: VendorStatus;
  /** Human-readable reason persisted to vendors.status_reason. */
  reason: string;
  /** disputeCount / soldCount, or null below the volume gate. */
  disputeRate: number | null;
}

/**
 * Map windowed counts to an enforcement status. Pure — negative or non-finite
 * inputs are floored to 0 so malformed counts can never suspend a vendor.
 */
export function computeVendorStatus({ soldCount, disputeCount }: EnforcementInput): EnforcementDecision {
  const sold = Number.isFinite(soldCount) && soldCount > 0 ? Math.floor(soldCount) : 0;
  const disputes = Number.isFinite(disputeCount) && disputeCount > 0 ? Math.floor(disputeCount) : 0;

  if (sold < ENFORCE_MIN_SALES) {
    return {
      status: "active",
      reason: `Below enforcement volume (${sold}/${ENFORCE_MIN_SALES} sales in ${ENFORCE_WINDOW_DAYS}d)`,
      disputeRate: null,
    };
  }

  const rate = disputes / sold;
  const pct = (rate * 100).toFixed(1);

  if (rate >= SUSPEND_RATE) {
    return {
      status: "suspended",
      reason: `Approved-dispute rate ${pct}% (${disputes}/${sold}) ≥ ${SUSPEND_RATE * 100}% over ${ENFORCE_WINDOW_DAYS}d`,
      disputeRate: rate,
    };
  }
  if (rate >= THROTTLE_RATE) {
    return {
      status: "throttled",
      reason: `Approved-dispute rate ${pct}% (${disputes}/${sold}) ≥ ${THROTTLE_RATE * 100}% over ${ENFORCE_WINDOW_DAYS}d`,
      disputeRate: rate,
    };
  }
  return {
    status: "active",
    reason: `Approved-dispute rate ${pct}% (${disputes}/${sold}) within limits`,
    disputeRate: rate,
  };
}
