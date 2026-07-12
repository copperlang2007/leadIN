import { describe, it, expect } from "vitest";
import { startOfMonthUtc, exceedsCap } from "./spendCaps";

describe("startOfMonthUtc", () => {
  it("returns the first instant of the current UTC month", () => {
    const s = startOfMonthUtc(new Date("2026-03-17T13:45:12.000Z"));
    expect(s.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("is idempotent at the month boundary", () => {
    const s = startOfMonthUtc(new Date("2026-03-01T00:00:00.000Z"));
    expect(s.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("uses UTC, not local time, for the year/month", () => {
    // Late-UTC-Dec instant is still December in UTC.
    const s = startOfMonthUtc(new Date("2026-12-31T23:59:59.000Z"));
    expect(s.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("exceedsCap", () => {
  it("is a no-op (never exceeds) when the cap is null/undefined", () => {
    expect(exceedsCap(999_999, 999_999, null)).toBe(false);
    expect(exceedsCap(999_999, 999_999, undefined)).toBe(false);
  });

  it("allows a purchase that lands exactly on the cap", () => {
    expect(exceedsCap(4000, 1000, 5000)).toBe(false); // 40.00 + 10.00 == 50.00
  });

  it("rejects a purchase one cent over the cap", () => {
    expect(exceedsCap(4000, 1001, 5000)).toBe(true);
  });

  it("rejects when prior spend alone already meets the cap", () => {
    expect(exceedsCap(5000, 1, 5000)).toBe(true);
  });

  it("allows any purchase when nothing has been spent and it fits", () => {
    expect(exceedsCap(0, 5000, 5000)).toBe(false);
    expect(exceedsCap(0, 5001, 5000)).toBe(true);
  });
});
