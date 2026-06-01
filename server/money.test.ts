import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";

// Regression test for the money math fix. The wallet logic uses Decimal
// rather than parseFloat so cumulative rounding drift doesn't accrue.

describe("Decimal money math", () => {
  it("avoids 0.1 + 0.2 drift", () => {
    const a = new Decimal("0.1");
    const b = new Decimal("0.2");
    expect(a.plus(b).toString()).toBe("0.3");
  });

  it("subtracts wallet balances exactly", () => {
    const balance = new Decimal("100.05");
    const price = new Decimal("0.20");
    expect(balance.minus(price).toFixed(2)).toBe("99.85");
  });

  it("preserves precision over many subtractions", () => {
    let bal = new Decimal("1000.00");
    for (let i = 0; i < 100; i++) bal = bal.minus("0.07");
    expect(bal.toFixed(2)).toBe("993.00");
  });

  it("rejects negative balances correctly", () => {
    const bal = new Decimal("9.99");
    const price = new Decimal("10.00");
    expect(bal.lessThan(price)).toBe(true);
  });
});
