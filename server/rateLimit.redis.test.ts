// Exercises the Redis-backed code paths of rateLimit by mocking
// `./lib/redis` with an in-memory fake. No real Redis is needed for `npm test`.
//
// We assert two things per primitive:
//   1) The happy-path semantics (counter / SET NX / SET NX EX) match what the
//      in-memory backend would do.
//   2) When the fake client throws, we fall back to the in-memory backend
//      instead of bubbling the error to the caller.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Simple in-memory fake of the subset of redis used by rateLimit.ts.
// Mirrors the shape from server/lib/redis.ts.
type Entry = { value: string; expiresAt: number | null };

function makeFakeRedis() {
  const store = new Map<string, Entry>();
  const now = () => Date.now();
  const isExpired = (e: Entry) => e.expiresAt !== null && e.expiresAt <= now();
  const live = (k: string) => {
    const e = store.get(k);
    if (!e) return null;
    if (isExpired(e)) { store.delete(k); return null; }
    return e;
  };

  const client = {
    failNext: false as boolean | string,
    async get(key: string) {
      const e = live(key);
      return e ? e.value : null;
    },
    async set(key: string, value: string, opts?: { EX?: number; NX?: boolean }) {
      if (client.failNext) {
        const msg = typeof client.failNext === "string" ? client.failNext : "boom";
        client.failNext = false;
        throw new Error(msg);
      }
      const existing = live(key);
      if (opts?.NX && existing) return null;
      const expiresAt = opts?.EX ? now() + opts.EX * 1000 : null;
      store.set(key, { value, expiresAt });
      return "OK";
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
    async incr(key: string) {
      if (client.failNext) {
        const msg = typeof client.failNext === "string" ? client.failNext : "boom";
        client.failNext = false;
        throw new Error(msg);
      }
      const e = live(key);
      const next = (e ? parseInt(e.value, 10) : 0) + 1;
      store.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
      return next;
    },
    async expire(key: string, seconds: number) {
      const e = live(key);
      if (!e) return 0;
      e.expiresAt = now() + seconds * 1000;
      return 1;
    },
    async quit() { return "OK"; },
    __store: store,
  };
  return client;
}

const fakeRedis = makeFakeRedis();

vi.mock("./lib/redis", () => ({
  getRedis: vi.fn(async () => fakeRedis),
  hasRedis: () => true,
}));

// Import AFTER vi.mock so the module picks up the mocked getRedis.
const {
  takeToken,
  seenRecently,
  throttleFire,
  __setForceMemoryForTests,
  __resetForTests,
} = await import("./rateLimit");

describe("rateLimit (Redis backend, mocked client)", () => {
  beforeEach(() => {
    __setForceMemoryForTests(false);
    __resetForTests();
    fakeRedis.__store.clear();
    fakeRedis.failNext = false;
  });

  it("takeToken: counter-based — blocks once capacity is exceeded in window", async () => {
    const k = `tb-${Math.random()}`;
    expect(await takeToken(k, 3, 5)).toBe(true);
    expect(await takeToken(k, 3, 5)).toBe(true);
    expect(await takeToken(k, 3, 5)).toBe(true);
    expect(await takeToken(k, 3, 5)).toBe(false);
    expect(await takeToken(k, 3, 5)).toBe(false);
  });

  it("takeToken: sets TTL on the first INCR only", async () => {
    const k = `tb-ttl-${Math.random()}`;
    await takeToken(k, 10, 1);
    const e1 = fakeRedis.__store.get(`rl:tb:${k}`);
    expect(e1?.expiresAt).not.toBeNull();
    const firstExpiry = e1!.expiresAt;
    // Subsequent calls should not bump the TTL.
    await new Promise((r) => setTimeout(r, 5));
    await takeToken(k, 10, 1);
    const e2 = fakeRedis.__store.get(`rl:tb:${k}`);
    expect(e2?.expiresAt).toBe(firstExpiry);
  });

  it("takeToken: falls back to in-memory when Redis throws", async () => {
    const k = `tb-fallback-${Math.random()}`;
    fakeRedis.failNext = "redis down";
    // The first call hits Redis, which throws — but the in-memory bucket
    // should still allow the request.
    expect(await takeToken(k, 2, 0)).toBe(true);
  });

  it("seenRecently: returns false the first time, true while the key lives", async () => {
    const k = `sn-${Math.random()}`;
    expect(await seenRecently(k, 60_000)).toBe(false);
    expect(await seenRecently(k, 60_000)).toBe(true);
    expect(await seenRecently(k, 60_000)).toBe(true);
  });

  it("seenRecently: falls back to in-memory when Redis throws", async () => {
    const k = `sn-fallback-${Math.random()}`;
    fakeRedis.failNext = "redis down";
    expect(await seenRecently(k, 1000)).toBe(false);
  });

  it("throttleFire: fires once per window", async () => {
    const k = `th-${Math.random()}`;
    expect(await throttleFire(k, 60_000)).toBe(true);
    expect(await throttleFire(k, 60_000)).toBe(false);
    expect(await throttleFire(k, 60_000)).toBe(false);
  });

  it("throttleFire: falls back to in-memory when Redis throws", async () => {
    const k = `th-fallback-${Math.random()}`;
    fakeRedis.failNext = "redis down";
    expect(await throttleFire(k, 10_000)).toBe(true);
  });

  it("keys are namespaced so token-bucket, dedupe and throttle don't collide", async () => {
    const k = `ns-${Math.random()}`;
    await takeToken(k, 1, 0);
    await seenRecently(k, 60_000);
    await throttleFire(k, 60_000);
    const keys = Array.from(fakeRedis.__store.keys());
    expect(keys.some((x) => x.startsWith("rl:tb:"))).toBe(true);
    expect(keys.some((x) => x.startsWith("rl:seen:"))).toBe(true);
    expect(keys.some((x) => x.startsWith("rl:thr:"))).toBe(true);
  });
});
