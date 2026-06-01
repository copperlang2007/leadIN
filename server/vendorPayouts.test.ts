import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { splitRevenue, getRevSharePct } from "./vendorPayouts";

describe("splitRevenue", () => {
  it("returns 0 vendor share when sharePct is 0", () => {
    const { vendorCents, platformCents } = splitRevenue(10_000, 0);
    expect(vendorCents).toBe(0);
    expect(platformCents).toBe(10_000);
  });

  it("returns full vendor share when sharePct is 1", () => {
    const { vendorCents, platformCents } = splitRevenue(10_000, 1);
    expect(vendorCents).toBe(10_000);
    expect(platformCents).toBe(0);
  });

  it("applies the default 60% split when called without args", () => {
    // 5000 cents @ default 0.6 = 3000 vendor / 2000 platform
    const { vendorCents, platformCents } = splitRevenue(5_000);
    expect(vendorCents).toBe(3_000);
    expect(platformCents).toBe(2_000);
  });

  it("floors fractional cents to the platform (never over-credits vendor)", () => {
    // 333 * 0.6 = 199.8 → vendor 199, platform 134; sum must equal input
    const { vendorCents, platformCents } = splitRevenue(333, 0.6);
    expect(vendorCents).toBe(199);
    expect(platformCents).toBe(134);
    expect(vendorCents + platformCents).toBe(333);
  });

  it("clamps a sharePct above 1 down to 1, and below 0 up to 0", () => {
    expect(splitRevenue(1_000, 5)).toEqual({ vendorCents: 1_000, platformCents: 0 });
    expect(splitRevenue(1_000, -2)).toEqual({ vendorCents: 0, platformCents: 1_000 });
  });

  it("returns integers and never sums to more than the input", () => {
    for (const price of [1, 7, 99, 100, 1234, 99_999]) {
      for (const pct of [0, 0.05, 0.5, 0.6, 0.999, 1]) {
        const { vendorCents, platformCents } = splitRevenue(price, pct);
        expect(Number.isInteger(vendorCents)).toBe(true);
        expect(Number.isInteger(platformCents)).toBe(true);
        expect(vendorCents + platformCents).toBe(price);
        expect(vendorCents).toBeGreaterThanOrEqual(0);
        expect(platformCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rejects junk inputs (negative, NaN, zero) by returning zero shares", () => {
    expect(splitRevenue(0)).toEqual({ vendorCents: 0, platformCents: 0 });
    expect(splitRevenue(-100, 0.6)).toEqual({ vendorCents: 0, platformCents: 0 });
    expect(splitRevenue(Number.NaN, 0.6)).toEqual({ vendorCents: 0, platformCents: 0 });
    expect(splitRevenue(Number.POSITIVE_INFINITY, 0.6)).toEqual({ vendorCents: 0, platformCents: 0 });
  });

  it("falls back to default when sharePct is NaN", () => {
    // NaN sharePct → default 0.6 → 600 vendor / 400 platform
    expect(splitRevenue(1_000, Number.NaN)).toEqual({ vendorCents: 600, platformCents: 400 });
  });
});

describe("getRevSharePct", () => {
  const original = process.env.REV_SHARE_PCT;
  beforeEach(() => {
    delete process.env.REV_SHARE_PCT;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.REV_SHARE_PCT;
    else process.env.REV_SHARE_PCT = original;
  });

  it("defaults to 0.6 when env unset", () => {
    expect(getRevSharePct()).toBe(0.6);
  });

  it("parses a valid env override", () => {
    process.env.REV_SHARE_PCT = "0.75";
    expect(getRevSharePct()).toBe(0.75);
  });

  it("clamps env values outside [0,1]", () => {
    process.env.REV_SHARE_PCT = "1.5";
    expect(getRevSharePct()).toBe(1);
    process.env.REV_SHARE_PCT = "-0.5";
    expect(getRevSharePct()).toBe(0);
  });

  it("falls back to default on unparseable env", () => {
    process.env.REV_SHARE_PCT = "notanumber";
    expect(getRevSharePct()).toBe(0.6);
  });
});
