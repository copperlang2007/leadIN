import { describe, it, expect } from "vitest";
import { createIdempotencyTracker } from "./eventIdempotency.js";

describe("createIdempotencyTracker", () => {
  it("returns true for the first sighting and false for subsequent ones", () => {
    const t = createIdempotencyTracker();
    expect(t.markSeenOnce("evt_1")).toBe(true);
    expect(t.markSeenOnce("evt_1")).toBe(false);
    expect(t.markSeenOnce("evt_1")).toBe(false);
  });

  it("tracks distinct event ids independently", () => {
    const t = createIdempotencyTracker();
    expect(t.markSeenOnce("evt_1")).toBe(true);
    expect(t.markSeenOnce("evt_2")).toBe(true);
    expect(t.markSeenOnce("evt_1")).toBe(false);
    expect(t.markSeenOnce("evt_2")).toBe(false);
    expect(t.size()).toBe(2);
  });

  it("expires entries past the TTL", () => {
    let clock = 1_000_000;
    const t = createIdempotencyTracker({ ttlMs: 1000, now: () => clock });
    expect(t.markSeenOnce("evt_1")).toBe(true);
    clock += 999;
    expect(t.markSeenOnce("evt_1")).toBe(false);
    clock += 2;
    // TTL exceeded — counts as new.
    expect(t.markSeenOnce("evt_1")).toBe(true);
  });

  it("evicts the oldest entries when the cap is reached", () => {
    const t = createIdempotencyTracker({ maxEntries: 3 });
    t.markSeenOnce("evt_1");
    t.markSeenOnce("evt_2");
    t.markSeenOnce("evt_3");
    t.markSeenOnce("evt_4"); // evicts evt_1 (oldest)
    expect(t.size()).toBe(3);
    // evt_1 was evicted, so it counts as new again.
    expect(t.markSeenOnce("evt_1")).toBe(true);
    // The newer ones added before the cap was reached are still cached.
    expect(t.markSeenOnce("evt_3")).toBe(false);
    expect(t.markSeenOnce("evt_4")).toBe(false);
  });

  it("fails safe on empty event id by reporting duplicate (skip)", () => {
    const t = createIdempotencyTracker();
    // Returning false makes the caller short-circuit, preventing a
    // malformed payload from bypassing dedup.
    expect(t.markSeenOnce("")).toBe(false);
    expect(t.size()).toBe(0);
  });

  it("clear() wipes the cache", () => {
    const t = createIdempotencyTracker();
    t.markSeenOnce("evt_1");
    t.markSeenOnce("evt_2");
    expect(t.size()).toBe(2);
    t.clear();
    expect(t.size()).toBe(0);
    expect(t.markSeenOnce("evt_1")).toBe(true);
  });
});
