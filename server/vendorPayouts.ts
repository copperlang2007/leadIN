// Vendor payouts — pure helpers for revenue-share math.
//
// The DB writes live in `storage.ts` (so they share the IStorage interface
// and the existing transaction infrastructure). This module owns the
// money-split arithmetic so it stays unit-testable without a DB.

const DEFAULT_REV_SHARE_PCT = 0.6;

/**
 * Resolve the vendor revenue share fraction.
 *
 * Reads `process.env.REV_SHARE_PCT` (a decimal fraction like "0.6").
 * Falls back to 0.6 if unset/invalid. Always clamped to [0, 1].
 */
export function getRevSharePct(): number {
  const raw = process.env.REV_SHARE_PCT;
  if (raw === undefined || raw === "") return DEFAULT_REV_SHARE_PCT;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_REV_SHARE_PCT;
  return clamp01(parsed);
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Split a sale price (in cents) into vendor share + platform share.
 *
 * `vendorCents = floor(salePriceCents * sharePct)`. The remainder goes to
 * the platform. Always returns integers; never returns a sum that exceeds
 * the input.
 *
 * Defensive against junk inputs:
 *   - negative or non-finite salePriceCents → both shares = 0
 *   - non-finite sharePct → treated as default
 *   - sharePct clamped to [0, 1]
 */
export function splitRevenue(
  salePriceCents: number,
  sharePct: number = getRevSharePct(),
): { vendorCents: number; platformCents: number } {
  if (!Number.isFinite(salePriceCents) || salePriceCents <= 0) {
    return { vendorCents: 0, platformCents: 0 };
  }
  const pct = Number.isFinite(sharePct) ? clamp01(sharePct) : DEFAULT_REV_SHARE_PCT;
  // Use integer cents and floor so we never over-credit the vendor.
  const totalCents = Math.floor(salePriceCents);
  const vendorCents = Math.floor(totalCents * pct);
  const platformCents = totalCents - vendorCents;
  return { vendorCents, platformCents };
}
