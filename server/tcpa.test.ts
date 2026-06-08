// Unit tests for the TCPA pure helpers in `./tcpa`.
//
// These exercise the per-claim clamp, the aggregate sum (which only counts
// `approved` claims), the aggregate-exceedance check, and the high-level
// `validateApprovedPayout` orchestration that combines them.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_AGGREGATE_LIMIT_CENTS,
  DEFAULT_PER_CLAIM_LIMIT_CENTS,
  clampClaimPayout,
  computeAggregatePaidCents,
  validateApprovedPayout,
  wouldExceedAggregate,
} from "./tcpa";

describe("default policy limits", () => {
  it("matches the schema defaults of $25k per claim / $100k aggregate", () => {
    expect(DEFAULT_PER_CLAIM_LIMIT_CENTS).toBe(2_500_000);
    expect(DEFAULT_AGGREGATE_LIMIT_CENTS).toBe(10_000_000);
  });
});

describe("clampClaimPayout", () => {
  it("returns the requested amount when within the per-claim limit", () => {
    expect(clampClaimPayout(1_000_000, 2_500_000)).toBe(1_000_000);
    expect(clampClaimPayout(2_500_000, 2_500_000)).toBe(2_500_000);
  });

  it("clamps a request larger than the per-claim limit down to the cap", () => {
    expect(clampClaimPayout(5_000_000, 2_500_000)).toBe(2_500_000);
  });

  it("collapses non-positive or non-finite inputs to 0", () => {
    expect(clampClaimPayout(0, 2_500_000)).toBe(0);
    expect(clampClaimPayout(-1, 2_500_000)).toBe(0);
    expect(clampClaimPayout(Number.NaN, 2_500_000)).toBe(0);
    expect(clampClaimPayout(1_000_000, 0)).toBe(0);
    expect(clampClaimPayout(1_000_000, -1)).toBe(0);
  });

  it("floors fractional cents to integers", () => {
    expect(clampClaimPayout(1_000_000.9, 2_500_000)).toBe(1_000_000);
  });
});

describe("computeAggregatePaidCents", () => {
  it("only sums approved claims", () => {
    const sum = computeAggregatePaidCents([
      { status: "approved", amountPaidCents: 1_000_000 },
      { status: "approved", amountPaidCents: 500_000 },
      { status: "denied", amountPaidCents: 999_999 },
      { status: "open", amountPaidCents: 999_999 },
    ]);
    expect(sum).toBe(1_500_000);
  });

  it("ignores null / negative / non-finite amounts on approved claims", () => {
    const sum = computeAggregatePaidCents([
      { status: "approved", amountPaidCents: null },
      { status: "approved", amountPaidCents: -100 },
      { status: "approved", amountPaidCents: Number.NaN },
      { status: "approved", amountPaidCents: 123_456 },
    ]);
    expect(sum).toBe(123_456);
  });

  it("returns 0 for an empty list", () => {
    expect(computeAggregatePaidCents([])).toBe(0);
  });
});

describe("wouldExceedAggregate", () => {
  it("returns true when the proposed payout pushes the total over the cap", () => {
    expect(wouldExceedAggregate(1, 10_000_000, 10_000_000)).toBe(true);
    expect(wouldExceedAggregate(2_500_000, 8_000_000, 10_000_000)).toBe(true);
  });

  it("returns false when the proposed payout fits exactly under the cap", () => {
    expect(wouldExceedAggregate(2_000_000, 8_000_000, 10_000_000)).toBe(false);
  });

  it("returns false at exactly the aggregate cap (paying the last cents)", () => {
    expect(wouldExceedAggregate(0, 10_000_000, 10_000_000)).toBe(false);
  });

  it("treats negative / NaN inputs as 0", () => {
    expect(wouldExceedAggregate(Number.NaN, 0, 10_000_000)).toBe(false);
    expect(wouldExceedAggregate(-100, 0, 10_000_000)).toBe(false);
  });
});

describe("validateApprovedPayout", () => {
  it("returns the clamped payout when within both limits", () => {
    const out = validateApprovedPayout({
      amountPaidCents: 1_000_000,
      perClaimLimitCents: 2_500_000,
      aggregateLimitCents: 10_000_000,
      alreadyPaidAggregateCents: 2_000_000,
    });
    expect(out).toBe(1_000_000);
  });

  it("clamps the per-claim payout to the cap", () => {
    const out = validateApprovedPayout({
      amountPaidCents: 5_000_000,
      perClaimLimitCents: 2_500_000,
      aggregateLimitCents: 10_000_000,
      alreadyPaidAggregateCents: 0,
    });
    expect(out).toBe(2_500_000);
  });

  it("throws when the amount is not a positive integer", () => {
    expect(() =>
      validateApprovedPayout({
        amountPaidCents: 0,
        perClaimLimitCents: 2_500_000,
        aggregateLimitCents: 10_000_000,
        alreadyPaidAggregateCents: 0,
      }),
    ).toThrow(/positive integer/);
  });

  it("throws when the per-claim limit is zero", () => {
    expect(() =>
      validateApprovedPayout({
        amountPaidCents: 1_000_000,
        perClaimLimitCents: 0,
        aggregateLimitCents: 10_000_000,
        alreadyPaidAggregateCents: 0,
      }),
    ).toThrow(/Per-claim limit is zero/);
  });

  it("throws when the post-payment aggregate would exceed the policy cap", () => {
    expect(() =>
      validateApprovedPayout({
        amountPaidCents: 2_500_000,
        perClaimLimitCents: 2_500_000,
        aggregateLimitCents: 10_000_000,
        alreadyPaidAggregateCents: 8_000_000,
      }),
    ).toThrow(/aggregate limit/);
  });

  it("allows a payout that exactly hits the aggregate cap", () => {
    const out = validateApprovedPayout({
      amountPaidCents: 2_500_000,
      perClaimLimitCents: 2_500_000,
      aggregateLimitCents: 10_000_000,
      alreadyPaidAggregateCents: 7_500_000,
    });
    expect(out).toBe(2_500_000);
  });
});
