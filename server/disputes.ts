// Pure helpers for buyer-filed lead disputes.
//
// The DB writes live in `storage.ts` (so they share IStorage + the existing
// transaction infrastructure). This module owns the refund math — clamping the
// refund to the order price, splitting the vendor debit per REV_SHARE_PCT, and
// planning the pending-then-paid pull from `vendor_balances` — so it stays
// unit-testable without a live DB.

import Decimal from "decimal.js";
import { getRevSharePct, splitRevenue } from "./vendorPayouts";

export type DisputeReason =
  | "bad_contact"
  | "duplicate"
  | "fraud"
  | "not_as_described"
  | "other";

/**
 * Convert a decimal dollars string (e.g. order.price = "100.00") into
 * integer cents using banker-safe Decimal math.
 */
export function priceStringToCents(priceStr: string | number): number {
  const d = new Decimal(priceStr);
  // ROUND_HALF_UP matches purchaseLead so price and refund stay symmetric.
  return d.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Clamp a requested refund to the order price. Negative / non-finite
 * requests collapse to 0.
 */
export function clampRefundCents(requestedCents: number, orderPriceCents: number): number {
  if (!Number.isFinite(requestedCents) || requestedCents <= 0) return 0;
  if (!Number.isFinite(orderPriceCents) || orderPriceCents <= 0) return 0;
  const r = Math.floor(requestedCents);
  const p = Math.floor(orderPriceCents);
  return r > p ? p : r;
}

/**
 * Compute the vendor debit and platform write-off for a refund.
 *
 * The buyer is always refunded the full `refundCents`. The vendor takes the
 * hit at REV_SHARE_PCT of the refund — i.e. they give back what they earned
 * on that sale. The remainder is a platform write-off (we ate the platform
 * cut on the original sale and now eat it on the refund too).
 *
 * Reuses `splitRevenue` so refund math and sale math always agree.
 */
export function computeRefundSplit(
  refundCents: number,
  sharePct: number = getRevSharePct(),
): { vendorDebitCents: number; platformWriteOffCents: number } {
  if (!Number.isFinite(refundCents) || refundCents <= 0) {
    return { vendorDebitCents: 0, platformWriteOffCents: 0 };
  }
  const { vendorCents, platformCents } = splitRevenue(Math.floor(refundCents), sharePct);
  return { vendorDebitCents: vendorCents, platformWriteOffCents: platformCents };
}

/**
 * Plan how the vendor debit will be drawn from `vendor_balances`.
 * Pulls from `pendingCents` first; falls back to `paidCents` for the
 * remainder. If both balances are insufficient, drives `paidCents` negative
 * so the ledger still balances (admin can chase recovery out-of-band).
 *
 * Returns the deltas to apply (always non-positive integers that sum to
 * `-vendorDebitCents`).
 */
export function planVendorDebit(
  vendorDebitCents: number,
  pendingCents: number,
  paidCents: number,
): { pendingDelta: number; paidDelta: number; newPendingCents: number; newPaidCents: number } {
  const debit = Math.max(0, Math.floor(vendorDebitCents));
  if (debit === 0) {
    return {
      pendingDelta: 0,
      paidDelta: 0,
      newPendingCents: pendingCents,
      newPaidCents: paidCents,
    };
  }
  const pending = Math.max(0, Math.floor(pendingCents));
  const paid = Math.floor(paidCents);
  if (debit <= pending) {
    return {
      pendingDelta: -debit,
      paidDelta: 0,
      newPendingCents: pending - debit,
      newPaidCents: paid,
    };
  }
  // Pending insufficient — drain it, then take the remainder from paid.
  const remainder = debit - pending;
  return {
    pendingDelta: -pending,
    paidDelta: -remainder,
    newPendingCents: 0,
    newPaidCents: paid - remainder,
  };
}

/**
 * Credit the buyer's wallet using Decimal arithmetic, returning the new
 * balance as a fixed-2 string suitable for the `users.balance` numeric
 * column.
 */
export function addRefundToBalance(currentBalance: string | number, refundCents: number): string {
  const cur = new Decimal(currentBalance);
  if (!Number.isFinite(refundCents) || refundCents <= 0) return cur.toFixed(2);
  const refundDollars = new Decimal(refundCents).div(100);
  return cur.plus(refundDollars).toFixed(2);
}
