import { describe, expect, it } from "vitest";
import {
  ENFORCE_MIN_SALES,
  SUSPEND_RATE,
  THROTTLE_RATE,
  computeVendorStatus,
} from "./vendorEnforcement";

describe("computeVendorStatus", () => {
  it("stays active below the volume gate regardless of disputes", () => {
    const d = computeVendorStatus({ soldCount: ENFORCE_MIN_SALES - 1, disputeCount: 9 });
    expect(d.status).toBe("active");
    expect(d.disputeRate).toBeNull();
  });

  it("activates enforcement exactly at the volume gate", () => {
    // 10 sales, 2 disputes = 20% → suspended
    const d = computeVendorStatus({ soldCount: ENFORCE_MIN_SALES, disputeCount: 2 });
    expect(d.status).toBe("suspended");
    expect(d.disputeRate).toBeCloseTo(0.2);
  });

  it("keeps a clean high-volume vendor active", () => {
    const d = computeVendorStatus({ soldCount: 200, disputeCount: 3 });
    expect(d.status).toBe("active");
    expect(d.disputeRate).toBeCloseTo(0.015);
  });

  it("throttles at the throttle boundary (inclusive)", () => {
    // 100 sales, 8 disputes = exactly THROTTLE_RATE
    const d = computeVendorStatus({ soldCount: 100, disputeCount: Math.round(THROTTLE_RATE * 100) });
    expect(d.status).toBe("throttled");
  });

  it("suspends at the suspend boundary (inclusive)", () => {
    // 100 sales, 15 disputes = exactly SUSPEND_RATE
    const d = computeVendorStatus({ soldCount: 100, disputeCount: Math.round(SUSPEND_RATE * 100) });
    expect(d.status).toBe("suspended");
  });

  it("stays throttled (not suspended) between the two thresholds", () => {
    const d = computeVendorStatus({ soldCount: 100, disputeCount: 10 });
    expect(d.status).toBe("throttled");
  });

  it("recovers to active as the window rolls (same math, lower counts)", () => {
    expect(computeVendorStatus({ soldCount: 100, disputeCount: 20 }).status).toBe("suspended");
    expect(computeVendorStatus({ soldCount: 100, disputeCount: 7 }).status).toBe("active");
  });

  it("floors malformed inputs instead of misfiring", () => {
    expect(computeVendorStatus({ soldCount: -5, disputeCount: NaN }).status).toBe("active");
    expect(computeVendorStatus({ soldCount: NaN, disputeCount: 50 }).status).toBe("active");
  });

  it("always returns a persistable reason", () => {
    for (const input of [
      { soldCount: 0, disputeCount: 0 },
      { soldCount: 100, disputeCount: 9 },
      { soldCount: 100, disputeCount: 50 },
    ]) {
      const d = computeVendorStatus(input);
      expect(d.reason.length).toBeGreaterThan(0);
      expect(d.reason.length).toBeLessThanOrEqual(200);
    }
  });
});
