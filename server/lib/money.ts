// Money math helpers.
//
// All currency math in this app should go through Decimal so we don't
// accrue rounding drift (the classic 0.1 + 0.2 ≠ 0.3 problem). These
// thin wrappers cover the common cases:
//
//   - toUsd(value)        coerce string|number → "1234.56"
//   - addUsd(...values)   sum a list of strings/numbers without drift
//   - divUsd(num, denom)  ratio (e.g. avg CPL) without drift
//   - centsToUsd(cents)   integer-cents → "12.34"
//
// Inputs accept strings (the shape Postgres returns from SUM on a
// decimal column), numbers, or anything decimal.js can swallow. Outputs
// are always 2-decimal strings — display-ready and DB-storage-ready.

import Decimal from "decimal.js";

export type MoneyInput = string | number | null | undefined;

function toDecimal(value: MoneyInput): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(0);
  }
}

/** Coerce any currency input to a 2-decimal USD string. */
export function toUsd(value: MoneyInput): string {
  return toDecimal(value).toFixed(2);
}

/** Sum any number of currency inputs without float drift. */
export function addUsd(...values: MoneyInput[]): string {
  let total = new Decimal(0);
  for (const v of values) total = total.plus(toDecimal(v));
  return total.toFixed(2);
}

/**
 * Divide `numerator` by `denominator` for currency math. Returns "0.00"
 * when the denominator is zero/missing — matches our "no-data" UI convention.
 */
export function divUsd(numerator: MoneyInput, denominator: MoneyInput, decimals = 2): string {
  const den = toDecimal(denominator);
  if (den.isZero()) return new Decimal(0).toFixed(decimals);
  return toDecimal(numerator).dividedBy(den).toFixed(decimals);
}

/**
 * Multiply two currency inputs. Useful for `purchased * avgCommission`
 * style projections.
 */
export function mulUsd(a: MoneyInput, b: MoneyInput): string {
  return toDecimal(a).times(toDecimal(b)).toFixed(2);
}

/** Integer cents → USD string. Clamps negatives to 0.00. */
export function centsToUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "0.00";
  if (cents < 0) return "0.00";
  return new Decimal(cents).dividedBy(100).toFixed(2);
}
