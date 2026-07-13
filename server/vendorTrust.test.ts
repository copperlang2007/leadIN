import { describe, it, expect } from "vitest";
import {
  computeTrustSignal,
  TRUST_EXCELLENT_MAX,
  TRUST_GOOD_MAX,
} from "./vendorTrust";

describe("computeTrustSignal", () => {
  describe("zero-division / new vendor", () => {
    it("returns null rate and 'new' when there are no sales", () => {
      expect(computeTrustSignal({ soldCount: 0, disputeCount: 0 })).toEqual({
        disputeRate: null,
        tier: "new",
      });
    });

    it("stays 'new' even if disputes exist but soldCount is 0 (no divide-by-zero)", () => {
      // Defensive: a dispute without a completed sale can't produce a rate.
      expect(computeTrustSignal({ soldCount: 0, disputeCount: 3 })).toEqual({
        disputeRate: null,
        tier: "new",
      });
    });
  });

  describe("excellent tier (rate < 2%)", () => {
    it("zero disputes over volume is excellent", () => {
      const r = computeTrustSignal({ soldCount: 100, disputeCount: 0 });
      expect(r.disputeRate).toBe(0);
      expect(r.tier).toBe("excellent");
    });

    it("just under 2% is excellent", () => {
      // 1 / 100 = 1% < 2%
      const r = computeTrustSignal({ soldCount: 100, disputeCount: 1 });
      expect(r.disputeRate).toBeCloseTo(0.01, 10);
      expect(r.tier).toBe("excellent");
    });
  });

  describe("good tier (2% <= rate < 8%)", () => {
    it("exactly 2% is 'good', not 'excellent' (lower boundary is exclusive)", () => {
      // 2 / 100 = 2% === TRUST_EXCELLENT_MAX
      const r = computeTrustSignal({ soldCount: 100, disputeCount: 2 });
      expect(r.disputeRate).toBe(TRUST_EXCELLENT_MAX);
      expect(r.tier).toBe("good");
    });

    it("mid-range (5%) is good", () => {
      const r = computeTrustSignal({ soldCount: 100, disputeCount: 5 });
      expect(r.disputeRate).toBeCloseTo(0.05, 10);
      expect(r.tier).toBe("good");
    });

    it("just under 8% is good", () => {
      // 7 / 100 = 7% < 8%
      const r = computeTrustSignal({ soldCount: 100, disputeCount: 7 });
      expect(r.tier).toBe("good");
    });
  });

  describe("watch tier (rate >= 8%)", () => {
    it("exactly 8% is 'watch', not 'good' (upper boundary is inclusive)", () => {
      // 8 / 100 = 8% === TRUST_GOOD_MAX
      const r = computeTrustSignal({ soldCount: 100, disputeCount: 8 });
      expect(r.disputeRate).toBe(TRUST_GOOD_MAX);
      expect(r.tier).toBe("watch");
    });

    it("high dispute rate is watch", () => {
      const r = computeTrustSignal({ soldCount: 100, disputeCount: 25 });
      expect(r.disputeRate).toBeCloseTo(0.25, 10);
      expect(r.tier).toBe("watch");
    });

    it("disputes exceeding sales still resolves to watch (rate > 1)", () => {
      const r = computeTrustSignal({ soldCount: 2, disputeCount: 5 });
      expect(r.disputeRate).toBe(2.5);
      expect(r.tier).toBe("watch");
    });
  });

  describe("defensive input handling", () => {
    it("floors negative counts to zero", () => {
      expect(computeTrustSignal({ soldCount: -5, disputeCount: 0 })).toEqual({
        disputeRate: null,
        tier: "new",
      });
      const r = computeTrustSignal({ soldCount: 100, disputeCount: -3 });
      expect(r.disputeRate).toBe(0);
      expect(r.tier).toBe("excellent");
    });

    it("ignores non-finite counts", () => {
      expect(computeTrustSignal({ soldCount: NaN, disputeCount: 1 })).toEqual({
        disputeRate: null,
        tier: "new",
      });
      const r = computeTrustSignal({ soldCount: 50, disputeCount: Infinity });
      expect(r.disputeRate).toBe(0);
      expect(r.tier).toBe("excellent");
    });

    it("truncates fractional counts (Math.floor)", () => {
      // 1.9 sold → 1, 0 disputes → excellent at rate 0
      const r = computeTrustSignal({ soldCount: 1.9, disputeCount: 0 });
      expect(r.disputeRate).toBe(0);
      expect(r.tier).toBe("excellent");
    });
  });

  it("threshold constants are ordered and sane", () => {
    expect(TRUST_EXCELLENT_MAX).toBeLessThan(TRUST_GOOD_MAX);
    expect(TRUST_EXCELLENT_MAX).toBeGreaterThan(0);
  });
});
