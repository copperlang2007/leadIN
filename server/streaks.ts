// Purchase streaks — a lightweight retention signal for agents.
//
// A "streak" is the number of consecutive UTC calendar days on which an agent
// completed at least one lead purchase. We surface the agent's CURRENT live
// streak plus their BEST-ever run as a nudge on the dashboard.
//
// All date logic lives here and is PURE (no DB, no clock reads beyond the
// injected `now`) so it can be unit-tested exhaustively and stays
// DST-agnostic: every day is a UTC calendar day, bucketed upstream via
// `AT TIME ZONE 'UTC'`, and compared here by integer epoch-day index.

const MS_PER_DAY = 86_400_000;

export interface StreakResult {
  /** Length of the consecutive run ending today or yesterday (UTC); 0 if stale. */
  current: number;
  /** Longest consecutive run ever observed in the input. */
  best: number;
  /** Most recent purchase day as 'YYYY-MM-DD' (UTC), or null when no purchases. */
  lastPurchaseDay: string | null;
}

/**
 * Convert a 'YYYY-MM-DD' UTC day string to an integer epoch-day index (days
 * since 1970-01-01 UTC). Because the string denotes a UTC midnight, the
 * division is exact and immune to timezone/DST drift.
 */
function dayStringToIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** The UTC epoch-day index that `now` falls on. */
function nowToDayIndex(now: Date): number {
  return Math.floor(now.getTime() / MS_PER_DAY);
}

/**
 * Compute current + best purchase streaks from a list of distinct 'YYYY-MM-DD'
 * UTC day strings.
 *
 * Semantics:
 *   - `best` is the longest consecutive run of days anywhere in the history.
 *   - `current` is the length of the consecutive run ending on the most recent
 *     purchase day, but ONLY if that day is TODAY or YESTERDAY (UTC). A streak
 *     stays "alive" through yesterday so an agent who simply hasn't bought yet
 *     today isn't shown as broken. If the most recent purchase is 2+ days old,
 *     `current` is 0.
 *   - Empty input → { current: 0, best: 0, lastPurchaseDay: null }.
 *
 * Input need not be sorted or unique; both are normalised here.
 */
export function computeStreak(purchaseDays: string[], now: Date): StreakResult {
  if (purchaseDays.length === 0) {
    return { current: 0, best: 0, lastPurchaseDay: null };
  }

  // Normalise to a sorted, de-duplicated ascending list of epoch-day indices.
  const uniqueIndices = Array.from(new Set(purchaseDays.map(dayStringToIndex))).sort(
    (a, b) => a - b,
  );

  // Longest consecutive run anywhere (best), plus the run length ending at the
  // final (most recent) day so we can decide `current`.
  let best = 1;
  let run = 1;
  for (let i = 1; i < uniqueIndices.length; i++) {
    if (uniqueIndices[i] === uniqueIndices[i - 1] + 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > best) best = run;
  }
  // After the loop `run` is the length of the consecutive run ending at the max
  // index (the most recent day).
  const runEndingAtLast = run;

  const lastIndex = uniqueIndices[uniqueIndices.length - 1];
  const today = nowToDayIndex(now);
  // Alive only if the most recent purchase is today or yesterday (UTC).
  const current = lastIndex === today || lastIndex === today - 1 ? runEndingAtLast : 0;

  // Echo back the most recent day exactly as an ISO 'YYYY-MM-DD' UTC string.
  const lastPurchaseDay = new Date(lastIndex * MS_PER_DAY).toISOString().slice(0, 10);

  return { current, best, lastPurchaseDay };
}
