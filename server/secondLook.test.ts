import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { secondLookQuote, computeReprice, type RepriceableLead } from "./secondLook";

// The pricing curve reads a handful of env knobs; pin them to known defaults
// so the assertions are deterministic regardless of the ambient environment.
const KNOBS = [
  "SECOND_LOOK_FRESH_HOURS",
  "SECOND_LOOK_FLOOR_PCT",
  "SECOND_LOOK_MIN_PRICE",
  "SECOND_LOOK_MAX_PER_RUN",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KNOBS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Explicit defaults: 24h fresh window, 50% floor.
  process.env.SECOND_LOOK_FRESH_HOURS = "24";
  process.env.SECOND_LOOK_FLOOR_PCT = "0.5";
});

afterEach(() => {
  for (const k of KNOBS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const H = 3_600_000; // ms per hour

describe("secondLookQuote — decay ladder", () => {
  it("leaves a fresh lead (< 24h) at full price, tier 0", () => {
    const q = secondLookQuote("100.00", 5);
    expect(q.price).toBe("100.00");
    expect(q.tier).toBe(0);
    expect(q.discountPct).toBe(0);
  });

  it("applies 15% at tier 1 (24–48h)", () => {
    const q = secondLookQuote("100.00", 30);
    expect(q.price).toBe("85.00");
    expect(q.tier).toBe(1);
  });

  it("applies 30% at tier 2 (48–72h)", () => {
    const q = secondLookQuote("100.00", 50);
    expect(q.price).toBe("70.00");
    expect(q.tier).toBe(2);
  });

  it("applies the floor (50%) at tier 3 (>= 72h)", () => {
    const q = secondLookQuote("100.00", 100);
    expect(q.price).toBe("50.00");
    expect(q.tier).toBe(3);
  });

  it("never drops below the percentage floor even deep into tier 3", () => {
    const q = secondLookQuote("100.00", 10_000);
    expect(Number(q.price)).toBeGreaterThanOrEqual(50);
  });

  it("caps earlier tiers at the floor when the floor is shallow", () => {
    // floor 10% off => max discount is 10%, so even tier 2's 30% is clamped.
    process.env.SECOND_LOOK_FLOOR_PCT = "0.9"; // price never below 90% of original
    const q = secondLookQuote("100.00", 50); // tier 2
    expect(q.price).toBe("90.00");
  });

  it("is monotonically non-increasing as the lead ages", () => {
    let prev = Infinity;
    for (const age of [0, 12, 24, 36, 48, 60, 72, 120, 500]) {
      const p = Number(secondLookQuote("60.00", age).price);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });

  it("respects an absolute minimum price floor", () => {
    process.env.SECOND_LOOK_MIN_PRICE = "40"; // never below $40
    // At tier 3 the pct floor alone would be $25 on a $50 sticker...
    const q = secondLookQuote("50.00", 100);
    expect(Number(q.price)).toBeGreaterThanOrEqual(40);
  });

  it("never raises price above the original even if min price exceeds it", () => {
    process.env.SECOND_LOOK_MIN_PRICE = "999";
    const q = secondLookQuote("30.00", 100);
    expect(Number(q.price)).toBeLessThanOrEqual(30);
  });

  it("rounds to whole cents", () => {
    const q = secondLookQuote("9.99", 30); // 15% off 9.99 = 8.4915
    expect(q.price).toBe("8.49");
  });

  it("falls back to the 24h default on a misconfigured 0/negative/NaN fresh window", () => {
    // A 0/sub-1h window would collapse the tiers and drop all inventory to the
    // floor on the next tick; freshHours() falls back to 24, so a 10h-old lead
    // stays fresh (tier 0) rather than jumping straight to tier 3.
    for (const bad of ["0", "-5", "not-a-number"]) {
      process.env.SECOND_LOOK_FRESH_HOURS = bad;
      expect(secondLookQuote("100.00", 10).tier).toBe(0);
    }
  });

  it("falls back to the 0.5 floor default when FLOOR_PCT is percent-shaped (> 1)", () => {
    // "50" reads as 50 (i.e. 5000%), which would clamp to a 100% floor and
    // silently disable all discounting. Reject > 1 and use the default so a
    // deep-tier lead still decays to 50%.
    process.env.SECOND_LOOK_FLOOR_PCT = "50";
    const q = secondLookQuote("100.00", 100); // tier 3
    expect(q.price).toBe("50.00");
    expect(q.discountPct).toBeCloseTo(0.5, 5);
  });
});

describe("computeReprice — eligibility + idempotency", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const base: RepriceableLead = {
    price: "100.00",
    originalPrice: null,
    createdAt: new Date(now.getTime() - 50 * H), // 50h old => tier 2
    sold: false,
    removed: false,
    pricingMode: "per_lead",
  };

  it("reprices an aged, unsold, per-lead lead and preserves the sticker as basis", () => {
    const plan = computeReprice(base, now);
    expect(plan.shouldReprice).toBe(true);
    expect(plan.newPrice).toBe("70.00");
    expect(plan.basisPrice).toBe("100.00");
    expect(plan.tier).toBe(2);
  });

  it("is a no-op for a still-fresh lead", () => {
    const fresh = { ...base, createdAt: new Date(now.getTime() - 5 * H) };
    expect(computeReprice(fresh, now).shouldReprice).toBe(false);
  });

  it("skips sold, removed, and non-per-lead inventory", () => {
    expect(computeReprice({ ...base, sold: true }, now).shouldReprice).toBe(false);
    expect(computeReprice({ ...base, removed: true }, now).shouldReprice).toBe(false);
    expect(computeReprice({ ...base, pricingMode: "pay_per_close" }, now).shouldReprice).toBe(false);
  });

  it("keeps decaying from the ORIGINAL, not the already-discounted price", () => {
    // Already repriced to tier-2 (70) with sticker 100; now it's tier 3 (>=72h).
    const repriced: RepriceableLead = {
      ...base,
      price: "70.00",
      originalPrice: "100.00",
      createdAt: new Date(now.getTime() - 100 * H),
    };
    const plan = computeReprice(repriced, now);
    expect(plan.newPrice).toBe("50.00"); // 50% of ORIGINAL 100, not 50% of 70
    expect(plan.basisPrice).toBe("100.00");
  });

  it("is idempotent within a tier — re-running makes no change", () => {
    // Already at the tier-2 price for its age; a second sweep must not move it.
    const settled: RepriceableLead = {
      ...base,
      price: "70.00",
      originalPrice: "100.00",
      createdAt: new Date(now.getTime() - 50 * H), // still tier 2
    };
    expect(computeReprice(settled, now).shouldReprice).toBe(false);
  });
});
