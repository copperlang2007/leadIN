// Tiny in-memory rate limiter + recompute throttle. Process-local. Suitable
// for single-instance deployments; a multi-instance setup should swap this
// for Redis. Keys are caller-defined (ip, userId, leadId, ...).

interface Bucket {
  tokens: number;
  refilledAt: number;
}

const buckets = new Map<string, Bucket>();

// Simple token-bucket: `capacity` tokens that refill at `refillPerSecond`.
export function takeToken(key: string, capacity: number, refillPerSecond: number): boolean {
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

// "Was this key seen in the last `windowMs`?" – used for cheap dedupe.
const seen = new Map<string, number>();
export function seenRecently(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < windowMs) return true;
  seen.set(key, now);
  return false;
}

// Background sweep so the maps don't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  seen.forEach((v, k) => { if (v < cutoff) seen.delete(k); });
  buckets.forEach((v, k) => { if (v.refilledAt < cutoff && v.tokens >= 1) buckets.delete(k); });
}, 60_000).unref?.();

// Throttle: returns true at most once per `windowMs` for the same key.
const lastFired = new Map<string, number>();
export function throttleFire(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = lastFired.get(key) ?? 0;
  if (now - last < windowMs) return false;
  lastFired.set(key, now);
  return true;
}
