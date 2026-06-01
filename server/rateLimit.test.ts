import { describe, it, expect } from "vitest";
import { takeToken, seenRecently, throttleFire } from "./rateLimit";

describe("rateLimit", () => {
  it("takeToken allows up to capacity then blocks", () => {
    const k = `t1-${Math.random()}`;
    expect(takeToken(k, 3, 0)).toBe(true);
    expect(takeToken(k, 3, 0)).toBe(true);
    expect(takeToken(k, 3, 0)).toBe(true);
    expect(takeToken(k, 3, 0)).toBe(false);
  });

  it("seenRecently dedupes within window", () => {
    const k = `t2-${Math.random()}`;
    expect(seenRecently(k, 1000)).toBe(false);
    expect(seenRecently(k, 1000)).toBe(true);
  });

  it("throttleFire only fires once per window", () => {
    const k = `t3-${Math.random()}`;
    expect(throttleFire(k, 10_000)).toBe(true);
    expect(throttleFire(k, 10_000)).toBe(false);
  });
});
