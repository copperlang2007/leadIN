import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createIdempotencyTracker,
  markSeenOnceDb,
  __setIdempotencyDbForTesting,
} from "./eventIdempotency.js";

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

// markSeenOnceDb writes to webhook_idempotency with ON CONFLICT DO
// NOTHING and uses the returning() row count to distinguish new from
// dup. Tests use a fake `insert` that mirrors the drizzle builder
// chain (insert → values → onConflictDoNothing → returning) so we
// don't need a live Postgres.
describe("markSeenOnceDb (DB-backed)", () => {
  afterEach(() => {
    __setIdempotencyDbForTesting(null);
  });

  function fakeDb(opts: {
    returningRows?: Array<{ source: string }>;
    throwOnInsert?: boolean;
  }) {
    const valuesCalls: any[] = [];
    const returning = vi.fn(async () => opts.returningRows ?? []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn((row: any) => {
      valuesCalls.push(row);
      if (opts.throwOnInsert) throw new Error("simulated DB failure");
      return { onConflictDoNothing };
    });
    const insert = vi.fn(() => ({ values }));
    // delete() chain stub so the DbIdempotencyDeps interface is fully
    // satisfied; pruneOldIdempotencyRows isn't exercised here, so the
    // chain just resolves to an empty result.
    const deleteFn = vi.fn(() => ({
      where: () => ({ returning: async () => [] }),
    }));
    return {
      insert: insert as any,
      delete: deleteFn as any,
      valuesCalls,
      returning,
      onConflictDoNothing,
    };
  }

  it("returns true on first sighting (DB inserts a row)", async () => {
    const db = fakeDb({ returningRows: [{ source: "stripe" }] });
    __setIdempotencyDbForTesting(db);

    const r = await markSeenOnceDb("stripe", "evt_first");
    expect(r).toBe(true);
    expect(db.valuesCalls[0]).toEqual({ source: "stripe", key: "evt_first" });
  });

  it("returns false on conflict (returning() yields zero rows)", async () => {
    const db = fakeDb({ returningRows: [] });
    __setIdempotencyDbForTesting(db);

    expect(await markSeenOnceDb("stripe", "evt_dup")).toBe(false);
  });

  it("hot-path short-circuit: in-memory dup skips the DB round-trip", async () => {
    const db = fakeDb({ returningRows: [{ source: "stripe" }] });
    __setIdempotencyDbForTesting(db);

    const tracker = createIdempotencyTracker();
    expect(await markSeenOnceDb("stripe", "evt_x", tracker)).toBe(true);
    // Second call with the same key + tracker should NOT touch the DB.
    expect(await markSeenOnceDb("stripe", "evt_x", tracker)).toBe(false);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("fails safe on DB error — returns true (process the event)", async () => {
    const db = fakeDb({ throwOnInsert: true });
    __setIdempotencyDbForTesting(db);
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await markSeenOnceDb("stripe", "evt_db_down")).toBe(true);
    expect(consoleErr).toHaveBeenCalled();

    consoleErr.mockRestore();
  });

  it("fails safe on empty key — returns false (skip)", async () => {
    const db = fakeDb({ returningRows: [{ source: "stripe" }] });
    __setIdempotencyDbForTesting(db);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await markSeenOnceDb("stripe", "")).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it("source namespace is preserved in the DB write (no cross-talk)", async () => {
    const db = fakeDb({ returningRows: [{ source: "crm-reputation" }] });
    __setIdempotencyDbForTesting(db);

    await markSeenOnceDb("crm-reputation", "hubspot:deal_42");
    expect(db.valuesCalls[0]).toEqual({
      source: "crm-reputation",
      key: "hubspot:deal_42",
    });
  });
});
