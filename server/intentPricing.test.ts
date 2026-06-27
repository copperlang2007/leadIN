import { describe, it, expect } from "vitest";
import {
  priceLead,
  qualityFactor,
  intentFactor,
  exclusivityFactor,
  demandFactor,
  computeDemandIndex,
} from "./intentPricing";

describe("factor mappings", () => {
  it("qualityFactor: 0->0.5, 50->1.0, 100->1.5, clamps", () => {
    expect(qualityFactor(0)).toBe(0.5);
    expect(qualityFactor(50)).toBe(1.0);
    expect(qualityFactor(100)).toBe(1.5);
    expect(qualityFactor(150)).toBe(1.5);
    expect(qualityFactor(-10)).toBe(0.5);
  });

  it("intentFactor: 0->0.6, 100->1.6", () => {
    expect(intentFactor(0)).toBe(0.6);
    expect(intentFactor(100)).toBe(1.6);
  });

  it("exclusivityFactor: exclusive premium", () => {
    expect(exclusivityFactor("Exclusive")).toBe(1.5);
    expect(exclusivityFactor("exclusive")).toBe(1.5);
    expect(exclusivityFactor("Shared")).toBe(1.0);
    expect(exclusivityFactor("")).toBe(1.0);
  });

  it("demandFactor clamps to [0.5, 2.0] and defaults to 1", () => {
    expect(demandFactor(undefined)).toBe(1);
    expect(demandFactor(5)).toBe(2.0);
    expect(demandFactor(0.1)).toBe(0.5);
    expect(demandFactor(1.25)).toBe(1.25);
  });
});

describe("priceLead", () => {
  it("a median lead (score 50, intent 0, shared, balanced) prices at base", () => {
    const r = priceLead({ basePrice: 40, mediscore: 50, intentScore: 0, exclusivity: "Shared" });
    // 40 * 1.0 * 0.6 * 1.0 * 1.0 = 24.00
    expect(r.qualityFactor).toBe(1.0);
    expect(r.price).toBe("24.00");
  });

  it("a top lead (high score, high intent, exclusive, surge) prices well above base", () => {
    const r = priceLead({
      basePrice: 40,
      mediscore: 100,
      intentScore: 100,
      exclusivity: "Exclusive",
      demandIndex: 2,
    });
    // 40 * 1.5 * 1.6 * 1.5 * 2 = 288.00
    expect(r.price).toBe("288.00");
    expect(r.clamped).toBe(false);
  });

  it("respects the ceiling and flags clamping", () => {
    const r = priceLead({
      basePrice: 40,
      mediscore: 100,
      intentScore: 100,
      exclusivity: "Exclusive",
      demandIndex: 2,
      ceiling: 150,
    });
    expect(r.price).toBe("150.00");
    expect(r.clamped).toBe(true);
    expect(r.rawPrice).toBe("288.00");
  });

  it("respects the floor for weak leads", () => {
    const r = priceLead({
      basePrice: 40,
      mediscore: 0,
      intentScore: 0,
      exclusivity: "Shared",
      floor: 15,
    });
    // raw = 40 * 0.5 * 0.6 * 1 * 1 = 12.00 -> floored to 15.00
    expect(r.rawPrice).toBe("12.00");
    expect(r.price).toBe("15.00");
    expect(r.clamped).toBe(true);
  });

  it("is decimal-precise (no float drift)", () => {
    const r = priceLead({ basePrice: "0.10", mediscore: 50, intentScore: 40, exclusivity: "Shared" });
    // 0.10 * 1.0 * 1.0 * 1.0 * 1.0 = 0.10
    expect(r.price).toBe("0.10");
  });

  it("clamps a negative base price to zero (never bills negative)", () => {
    const r = priceLead({ basePrice: -50, mediscore: 100, intentScore: 100, exclusivity: "Exclusive" });
    expect(r.price).toBe("0.00");
    expect(r.base).toBe("0.00");
  });

  it("does not throw on malformed (non-numeric / NaN) inputs", () => {
    const r = priceLead({
      basePrice: "not-a-number" as any,
      mediscore: NaN,
      intentScore: NaN,
      exclusivity: "Shared",
      floor: "junk" as any,
      ceiling: "junk" as any,
    });
    expect(r.price).toBe("0.00");
  });
});

describe("computeDemandIndex", () => {
  it("returns 1.0 with no supply", () => {
    expect(computeDemandIndex(10, 0)).toBe(1.0);
  });
  it("computes ratio and clamps", () => {
    expect(computeDemandIndex(10, 10)).toBe(1.0);
    expect(computeDemandIndex(100, 10)).toBe(2.0); // clamped
    expect(computeDemandIndex(1, 100)).toBe(0.5); // clamped
  });
});
