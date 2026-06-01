import { describe, it, expect, beforeEach } from "vitest";
import {
  takeToken,
  seenRecently,
  throttleFire,
  __setForceMemoryForTests,
  __resetForTests,
} from "./rateLimit";

describe("rateLimit (in-memory backend)", () => {
  beforeEach(() => {
    __setForceMemoryForTests(true);
    __resetForTests();
  });

  it("takeToken allows up to capacity then blocks", async () => {
    const k = `t1-${Math.random()}`;
    expect(await takeToken(k, 3, 0)).toBe(true);
    expect(await takeToken(k, 3, 0)).toBe(true);
    expect(await takeToken(k, 3, 0)).toBe(true);
    expect(await takeToken(k, 3, 0)).toBe(false);
  });

  it("seenRecently dedupes within window", async () => {
    const k = `t2-${Math.random()}`;
    expect(await seenRecently(k, 1000)).toBe(false);
    expect(await seenRecently(k, 1000)).toBe(true);
  });

  it("throttleFire only fires once per window", async () => {
    const k = `t3-${Math.random()}`;
    expect(await throttleFire(k, 10_000)).toBe(true);
    expect(await throttleFire(k, 10_000)).toBe(false);
  });
});
