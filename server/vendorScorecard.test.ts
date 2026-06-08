// Unit tests for the vendor scorecard's pure aggregation math.
//
// The DB-touching `getVendorScorecard` orchestrator is intentionally not
// exercised here — those are covered by integration tests. The math
// extracted into `computeScorecardFromRows` + `totalsFromRows` is the heart
// of the feature: conversion rate, dispute rate, revenue formatting, and
// (most importantly) the trailing-vs-prior pct_change join.

import { describe, it, expect } from "vitest";
import {
  computeScorecardFromRows,
  totalsFromRows,
  type ScorecardRawRow,
} from "./vendorScorecard";

const row = (overrides: Partial<ScorecardRawRow>): ScorecardRawRow => ({
  key: "Medicare Advantage",
  ingested: 0,
  sold: 0,
  avgMediscore: 0,
  disputes: 0,
  revenueCents: 0,
  ...overrides,
});

describe("computeScorecardFromRows", () => {
  it("returns an empty array when the vendor has zero leads in the window", () => {
    expect(computeScorecardFromRows([], [])).toEqual([]);
  });

  it("computes conversion rate and revenue formatting from raw rows", () => {
    const trailing = [row({ key: "MA", ingested: 100, sold: 25, avgMediscore: 64.4, revenueCents: 250_00 })];
    const out = computeScorecardFromRows(trailing, []);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("MA");
    expect(out[0].convRate).toBe(0.25);
    expect(out[0].avgMediscore).toBe(64);          // rounded to nearest int
    expect(out[0].revenueUsd).toBe("250.00");
    expect(out[0].disputeRate).toBe(0);             // no disputes, no sold-dispute denom collapse
  });

  it("computes dispute rate as disputes / sold (not / ingested)", () => {
    const trailing = [row({ key: "MA", ingested: 100, sold: 20, disputes: 3 })];
    const [r] = computeScorecardFromRows(trailing, []);
    // 3/20 = 0.15
    expect(r.disputeRate).toBe(0.15);
  });

  it("returns null pctChange when there is no prior data to compare to", () => {
    const trailing = [row({ key: "MA", ingested: 10, sold: 2, revenueCents: 5_000 })];
    const out = computeScorecardFromRows(trailing, []);
    expect(out[0].pctChange).toBeNull();
  });

  it("returns null pctChange when the prior window had zero revenue (avoids /0)", () => {
    const trailing = [row({ key: "MA", ingested: 10, sold: 2, revenueCents: 5_000 })];
    const prior = [row({ key: "MA", ingested: 5, sold: 0, revenueCents: 0 })];
    const out = computeScorecardFromRows(trailing, prior);
    expect(out[0].pctChange).toBeNull();
  });

  it("computes pctChange as (trailing - prior) / prior of revenue", () => {
    const trailing = [row({ key: "MA", ingested: 10, sold: 4, revenueCents: 150_00 })];
    const prior = [row({ key: "MA", ingested: 10, sold: 2, revenueCents: 100_00 })];
    const [r] = computeScorecardFromRows(trailing, prior);
    expect(r.pctChange).toBe(0.5);              // 150 → 100 = +50%

    const declining = computeScorecardFromRows(
      [row({ key: "MA", ingested: 10, sold: 1, revenueCents: 40_00 })],
      [row({ key: "MA", ingested: 10, sold: 4, revenueCents: 100_00 })],
    );
    expect(declining[0].pctChange).toBe(-0.6);  // 100 → 40 = -60%
  });

  it("matches prior data by key, not by position", () => {
    const trailing = [
      row({ key: "AcA", ingested: 10, sold: 1, revenueCents: 100_00 }),
      row({ key: "MA",  ingested: 10, sold: 5, revenueCents: 500_00 }),
    ];
    const prior = [
      // intentionally reversed
      row({ key: "MA",  ingested: 10, sold: 4, revenueCents: 400_00 }),
      row({ key: "AcA", ingested: 10, sold: 2, revenueCents: 200_00 }),
    ];
    const out = computeScorecardFromRows(trailing, prior);
    const ma = out.find(r => r.key === "MA")!;
    const aca = out.find(r => r.key === "AcA")!;
    expect(ma.pctChange).toBe(0.25);    // 400 → 500
    expect(aca.pctChange).toBe(-0.5);   // 200 → 100
  });

  it("sorts rows by revenue desc, then by sold desc as a tiebreaker", () => {
    const trailing = [
      row({ key: "A", ingested: 10, sold: 1, revenueCents: 100_00 }),
      row({ key: "B", ingested: 10, sold: 5, revenueCents: 500_00 }),
      row({ key: "C", ingested: 10, sold: 2, revenueCents: 500_00 }),  // tie with B by revenue
    ];
    const out = computeScorecardFromRows(trailing, []);
    expect(out.map(r => r.key)).toEqual(["B", "C", "A"]);
  });

  it("safely handles zero-ingested buckets without producing NaN/Infinity", () => {
    const trailing = [row({ key: "MA", ingested: 0, sold: 0, disputes: 0 })];
    const [r] = computeScorecardFromRows(trailing, []);
    expect(r.convRate).toBe(0);
    expect(r.disputeRate).toBe(0);
    expect(r.revenueUsd).toBe("0.00");
  });
});

describe("totalsFromRows", () => {
  it("rolls counts and revenue up across buckets", () => {
    const rows = [
      row({ ingested: 10, sold: 3, disputes: 1, revenueCents: 100_00 }),
      row({ ingested: 20, sold: 8, disputes: 2, revenueCents: 250_00 }),
    ];
    const t = totalsFromRows(rows);
    expect(t.ingested).toBe(30);
    expect(t.sold).toBe(11);
    expect(t.convRate).toBeCloseTo(11 / 30, 4);
    expect(t.disputes).toBe(3);
    expect(t.disputeRate).toBeCloseTo(3 / 11, 4);
    expect(t.revenueUsd).toBe("350.00");
  });

  it("returns zeroed totals on an empty input (vendor with no leads yet)", () => {
    expect(totalsFromRows([])).toEqual({
      ingested: 0,
      sold: 0,
      convRate: 0,
      revenueUsd: "0.00",
      disputes: 0,
      disputeRate: 0,
    });
  });
});
