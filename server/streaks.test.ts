import { describe, it, expect } from "vitest";
import { computeStreak } from "./streaks";

// A fixed "now" so every case is deterministic. 2026-03-17 13:45 UTC → the
// current UTC day is 2026-03-17, yesterday is 2026-03-16.
const NOW = new Date("2026-03-17T13:45:12.000Z");

describe("computeStreak", () => {
  it("returns zeros / null for empty input", () => {
    expect(computeStreak([], NOW)).toEqual({
      current: 0,
      best: 0,
      lastPurchaseDay: null,
    });
  });

  it("counts a single purchase made today as a 1-day current streak", () => {
    expect(computeStreak(["2026-03-17"], NOW)).toEqual({
      current: 1,
      best: 1,
      lastPurchaseDay: "2026-03-17",
    });
  });

  it("counts today + yesterday as a 2-day current streak", () => {
    expect(computeStreak(["2026-03-16", "2026-03-17"], NOW)).toEqual({
      current: 2,
      best: 2,
      lastPurchaseDay: "2026-03-17",
    });
  });

  it("keeps a streak that ended YESTERDAY alive (agent hasn't bought today yet)", () => {
    // Most recent day is yesterday → still current.
    expect(computeStreak(["2026-03-14", "2026-03-15", "2026-03-16"], NOW)).toEqual({
      current: 3,
      best: 3,
      lastPurchaseDay: "2026-03-16",
    });
  });

  it("treats a streak ending 2+ days ago as broken (current 0)", () => {
    // Most recent day is 2026-03-15 = two days before today → stale.
    expect(computeStreak(["2026-03-13", "2026-03-14", "2026-03-15"], NOW)).toEqual({
      current: 0,
      best: 3,
      lastPurchaseDay: "2026-03-15",
    });
  });

  it("breaks the current run at a gap but keeps counting only the live tail", () => {
    // 03-10..03-12 (run of 3), gap, then 03-16 + 03-17 (run of 2, live).
    expect(
      computeStreak(["2026-03-10", "2026-03-11", "2026-03-12", "2026-03-16", "2026-03-17"], NOW),
    ).toEqual({
      current: 2,
      best: 3,
      lastPurchaseDay: "2026-03-17",
    });
  });

  it("finds best across multiple historical runs, independent of current", () => {
    // Longest run is 03-01..03-05 (5). The live tail is just today (1).
    expect(
      computeStreak(
        ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-17"],
        NOW,
      ),
    ).toEqual({
      current: 1,
      best: 5,
      lastPurchaseDay: "2026-03-17",
    });
  });

  it("handles out-of-order and duplicate input", () => {
    expect(
      computeStreak(
        ["2026-03-17", "2026-03-15", "2026-03-16", "2026-03-15", "2026-03-17"],
        NOW,
      ),
    ).toEqual({
      current: 3,
      best: 3,
      lastPurchaseDay: "2026-03-17",
    });
  });

  it("current is 0 when only historical purchases exist and none are recent", () => {
    expect(computeStreak(["2026-01-01", "2026-01-02"], NOW)).toEqual({
      current: 0,
      best: 2,
      lastPurchaseDay: "2026-01-02",
    });
  });

  it("crosses a month boundary correctly (Feb 28 → Mar 1, 2026 is not a leap year)", () => {
    const now = new Date("2026-03-01T09:00:00.000Z");
    expect(computeStreak(["2026-02-27", "2026-02-28", "2026-03-01"], now)).toEqual({
      current: 3,
      best: 3,
      lastPurchaseDay: "2026-03-01",
    });
  });

  it("crosses a leap-day boundary (2024-02-28 → 02-29 → 03-01)", () => {
    const now = new Date("2024-03-01T00:00:01.000Z");
    expect(computeStreak(["2024-02-28", "2024-02-29", "2024-03-01"], now)).toEqual({
      current: 3,
      best: 3,
      lastPurchaseDay: "2024-03-01",
    });
  });

  it("is DST-agnostic: uses UTC days regardless of the wall-clock time within `now`", () => {
    // Late-UTC instant is still 2026-03-17 in UTC; a purchase 'today' counts.
    const lateNow = new Date("2026-03-17T23:59:59.000Z");
    expect(computeStreak(["2026-03-17"], lateNow).current).toBe(1);
    // Very-early-UTC instant is still the same UTC day.
    const earlyNow = new Date("2026-03-17T00:00:00.000Z");
    expect(computeStreak(["2026-03-16", "2026-03-17"], earlyNow).current).toBe(2);
  });

  it("a purchase dated in the future (ahead of `now`) is not treated as today/yesterday", () => {
    // Defensive: a clock-skew day after today shouldn't inflate the streak
    // boundary. lastIndex = today+1, which is neither today nor yesterday.
    expect(computeStreak(["2026-03-18"], NOW).current).toBe(0);
  });
});
