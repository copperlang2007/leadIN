import { describe, it, expect } from "vitest";
import { toUsd, addUsd, divUsd, mulUsd, centsToUsd } from "./money.js";

describe("toUsd", () => {
  it("formats numbers and strings to 2 decimals", () => {
    expect(toUsd(1)).toBe("1.00");
    expect(toUsd("1.5")).toBe("1.50");
    expect(toUsd("1.005")).toBe("1.01"); // Decimal half-up rounding
  });

  it("treats null/undefined/empty as 0", () => {
    expect(toUsd(null)).toBe("0.00");
    expect(toUsd(undefined)).toBe("0.00");
    expect(toUsd("")).toBe("0.00");
  });

  it("falls back to 0 on garbage input", () => {
    expect(toUsd("not a number")).toBe("0.00");
  });
});

describe("addUsd", () => {
  it("avoids 0.1 + 0.2 drift", () => {
    expect(addUsd("0.1", "0.2")).toBe("0.30");
  });

  it("sums an arbitrary list without drift", () => {
    // Native floats give 1.0000000000000002 here.
    expect(addUsd("0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0.1")).toBe("1.00");
  });

  it("ignores null/undefined silently", () => {
    expect(addUsd("10.00", null, undefined, "0.50")).toBe("10.50");
  });
});

describe("divUsd", () => {
  it("computes average CPL safely", () => {
    // 100.00 / 7 → 14.285714... → 14.29
    expect(divUsd("100.00", 7)).toBe("14.29");
  });

  it("returns 0 on zero/missing denominator", () => {
    expect(divUsd("100.00", 0)).toBe("0.00");
    expect(divUsd("100.00", null)).toBe("0.00");
  });

  it("supports custom decimals (e.g. for conversion rates)", () => {
    expect(divUsd("1", 3, 4)).toBe("0.3333");
  });
});

describe("mulUsd", () => {
  it("avoids cumulative product drift", () => {
    // 0.1 * 0.2 in native float = 0.020000000000000004
    expect(mulUsd("0.1", "0.2")).toBe("0.02");
  });

  it("computes purchased * conv * commission cleanly", () => {
    // mulUsd is binary — chain for three-way products.
    expect(mulUsd(mulUsd(15, "0.07"), 400)).toBe("420.00");
  });
});

describe("centsToUsd", () => {
  it("converts integer cents to a dollars string", () => {
    expect(centsToUsd(0)).toBe("0.00");
    expect(centsToUsd(1)).toBe("0.01");
    expect(centsToUsd(12345)).toBe("123.45");
    expect(centsToUsd(1_000_000)).toBe("10000.00");
  });

  it("clamps negatives to 0.00", () => {
    expect(centsToUsd(-5)).toBe("0.00");
  });

  it("returns 0.00 for null/undefined/NaN", () => {
    expect(centsToUsd(null)).toBe("0.00");
    expect(centsToUsd(undefined)).toBe("0.00");
    expect(centsToUsd(NaN)).toBe("0.00");
  });
});
