// Webhook event idempotency tracker.
//
// Stripe (and most providers) retry webhook deliveries on any non-2xx
// response — and sometimes on 2xx too, if the response is slow. The
// existing wallet top-up path is already idempotent through a
// per-session-id state machine. Subscription updates and any future
// side-effect (email notifications, audit rows, …) need event-id-level
// dedup to avoid running twice.
//
// This is an in-memory LRU+TTL store. Stripe's retries happen within
// minutes-to-hours of the first delivery, so the TTL covers the
// realistic retry window. The cap on size keeps the heap bounded — if
// we ever blow through 10k events in 24h, the oldest entries fall out.
//
// In a multi-instance deployment, each instance has its own cache. The
// risk is small: Stripe routes each webhook to one URL (load balancers
// stick the request to a single backend), and downstream side effects
// remain idempotent at the data layer. This tracker is a defence in
// depth, not the sole guard.

export interface IdempotencyTracker {
  markSeenOnce(eventId: string): boolean;
  size(): number;
  clear(): void;
}

interface Entry {
  eventId: string;
  seenAt: number;
}

export interface CreateOpts {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

export function createIdempotencyTracker(opts: CreateOpts = {}): IdempotencyTracker {
  const maxEntries = opts.maxEntries ?? 10_000;
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());
  // Map preserves insertion order — perfect for LRU eviction.
  const cache = new Map<string, Entry>();

  function prune(): void {
    const cutoff = now() - ttlMs;
    const stale: string[] = [];
    cache.forEach((entry, id) => {
      if (entry.seenAt < cutoff) stale.push(id);
    });
    for (let i = 0; i < stale.length; i++) cache.delete(stale[i]);
  }

  return {
    markSeenOnce(eventId: string): boolean {
      if (!eventId) return true; // Defensive: empty id can't be tracked, treat as new.
      prune();
      if (cache.has(eventId)) return false;
      cache.set(eventId, { eventId, seenAt: now() });
      // LRU cap — drop the oldest until we're back under the limit.
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return true;
    },
    size(): number {
      return cache.size;
    },
    clear(): void {
      cache.clear();
    },
  };
}

// Module-level default — what the Stripe webhook handler uses. Tests
// can spin up isolated trackers via createIdempotencyTracker().
export const stripeWebhookIdempotency: IdempotencyTracker = createIdempotencyTracker();
