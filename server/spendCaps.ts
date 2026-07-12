// Spend Caps (A2).
//
// An agency (org owner/admin) can cap how much each of its agents spends on
// leads per calendar month, independent of the agent's wallet balance. The cap
// lives on the agent's org membership (orgMembers.monthlySpendCapCents; NULL =
// uncapped) and is enforced inside the purchase transaction, so it can't be
// bypassed by a concurrent double-purchase — the buyer's wallet row is already
// locked FOR UPDATE there, which serialises that buyer's purchases.
//
// The pure helpers below (window boundary + over-cap check) are trivially
// unit-testable without a DB.

/**
 * First instant of the current UTC calendar month. The monthly spend window is
 * [startOfMonthUtc(now), now]; orders older than this don't count.
 */
export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Would spending `addCents` more push this member over their cap? A null cap
 * means uncapped (always false). Compared with strict `>` so a purchase that
 * lands exactly on the cap is allowed.
 */
export function exceedsCap(
  existingCents: number,
  addCents: number,
  capCents: number | null | undefined,
): boolean {
  if (capCents === null || capCents === undefined) return false;
  return existingCents + addCents > capCents;
}

// Error message thrown by the purchase path when a cap would be exceeded.
// Exported so the client + tests can recognise it without matching a literal.
export const ERR_SPEND_CAP = "Monthly spend cap exceeded";
