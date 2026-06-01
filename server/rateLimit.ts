// Rate limiter + recompute throttle. When REDIS_URL is set we use Redis so
// limits, dedupe, and throttles are coherent across instances. Otherwise we
// fall back to a process-local implementation that's fine for single-instance
// dev/test. Keys are caller-defined (ip, userId, leadId, ...).
//
// All three primitives return Promise<boolean>. The Redis backend uses simple
// counter/SET-NX primitives — see notes inline. Call sites in routes.ts must
// await these.

import { getRedis } from "./lib/redis";

// ---------------------------------------------------------------------------
// In-memory backend (used when Redis is unavailable / unset).
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  refilledAt: number;
}

const buckets = new Map<string, Bucket>();
const seen = new Map<string, number>();
const lastFired = new Map<string, number>();

function memTakeToken(key: string, capacity: number, refillPerSecond: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, refilledAt: now };
  const elapsedSec = (now - b.refilledAt) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSecond);
  b.refilledAt = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

function memSeenRecently(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < windowMs) return true;
  seen.set(key, now);
  return false;
}

function memThrottleFire(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = lastFired.get(key) ?? 0;
  if (now - last < windowMs) return false;
  lastFired.set(key, now);
  return true;
}

// Background sweep so the maps don't grow forever.
const sweepHandle = setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  seen.forEach((v, k) => { if (v < cutoff) seen.delete(k); });
  lastFired.forEach((v, k) => { if (v < cutoff) lastFired.delete(k); });
  buckets.forEach((v, k) => { if (v.refilledAt < cutoff && v.tokens >= 1) buckets.delete(k); });
}, 60_000);
sweepHandle.unref?.();

// ---------------------------------------------------------------------------
// Mode detection.
// ---------------------------------------------------------------------------

let modeLogged = false;
function logMode(distributed: boolean) {
  if (modeLogged) return;
  modeLogged = true;
  if (!distributed) {
    console.warn("WARN: rate limiter in single-instance mode");
  } else {
    console.log("[rateLimit] distributed mode (Redis) active");
  }
}

// In tests we want to be able to force the in-memory path even if the env is
// dirty. `__resetForTests` clears state between cases.
let forceMemory = false;
export function __setForceMemoryForTests(v: boolean) { forceMemory = v; modeLogged = false; }
export function __resetForTests() {
  buckets.clear();
  seen.clear();
  lastFired.clear();
  modeLogged = false;
}

async function getBackend(): Promise<Awaited<ReturnType<typeof getRedis>> | null> {
  if (forceMemory) {
    logMode(false);
    return null;
  }
  const r = await getRedis();
  logMode(!!r);
  return r;
}

// ---------------------------------------------------------------------------
// Public API. All async.
// ---------------------------------------------------------------------------

// Token-bucket: `capacity` tokens that refill at `refillPerSecond`.
//
// Redis backend note: instead of a true token-bucket (which would need a Lua
// script for atomicity), we approximate with a fixed-window counter sized so
// the average rate matches `refillPerSecond` and the burst matches `capacity`.
// We INCR a key with a TTL of `capacity / refillPerSecond` seconds (the time
// it takes to refill a full bucket). If the counter exceeds `capacity` within
// that window, we deny. This over-allows at window edges by at most one full
// bucket — acceptable for the abuse-prevention use case here, and avoids
// loading Lua. If refillPerSecond is 0 we use a 60s window as a sane default
// for "fixed N per minute" buckets like checkout.
export async function takeToken(
  key: string,
  capacity: number,
  refillPerSecond: number,
): Promise<boolean> {
  const r = await getBackend();
  if (!r) return memTakeToken(key, capacity, refillPerSecond);

  const windowSec = refillPerSecond > 0
    ? Math.max(1, Math.ceil(capacity / refillPerSecond))
    : 60;
  const rk = `rl:tb:${key}`;
  try {
    const count = await r.incr(rk);
    if (count === 1) {
      // Only set TTL on first hit of the window; subsequent INCRs preserve it.
      await r.expire(rk, windowSec);
    }
    return count <= capacity;
  } catch (err: any) {
    console.warn("[rateLimit] redis takeToken failed, falling back to memory:", err?.message);
    return memTakeToken(key, capacity, refillPerSecond);
  }
}

// "Was this key seen in the last `windowMs`?" – cheap dedupe via SET NX EX.
// SET NX returns "OK" on first write, null when the key already exists.
export async function seenRecently(key: string, windowMs: number): Promise<boolean> {
  const r = await getBackend();
  if (!r) return memSeenRecently(key, windowMs);

  const rk = `rl:seen:${key}`;
  const ex = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const ok = await r.set(rk, "1", { NX: true, EX: ex });
    // ok === "OK" means we just set it (not seen before). null means it
    // already existed (seen recently).
    return ok === null;
  } catch (err: any) {
    console.warn("[rateLimit] redis seenRecently failed, falling back to memory:", err?.message);
    return memSeenRecently(key, windowMs);
  }
}

// Throttle: returns true at most once per `windowMs` for the same key.
// Implemented as SET NX EX — the first caller wins, the rest see the key
// already set and back off until it expires.
export async function throttleFire(key: string, windowMs: number): Promise<boolean> {
  const r = await getBackend();
  if (!r) return memThrottleFire(key, windowMs);

  const rk = `rl:thr:${key}`;
  const ex = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const ok = await r.set(rk, "1", { NX: true, EX: ex });
    return ok !== null;
  } catch (err: any) {
    console.warn("[rateLimit] redis throttleFire failed, falling back to memory:", err?.message);
    return memThrottleFire(key, windowMs);
  }
}
