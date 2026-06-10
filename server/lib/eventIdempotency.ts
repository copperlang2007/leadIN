// Webhook event idempotency tracker.
//
// Stripe (and most providers) retry webhook deliveries on any non-2xx
// response — and sometimes on 2xx too, if the response is slow. The
// existing wallet top-up path is already idempotent through a
// per-session-id state machine. Subscription updates and any future
// side-effect (email notifications, audit rows, …) need event-id-level
// dedup to avoid running twice.
//
// Storage: in-memory insertion-order cap with TTL. NOT a true LRU —
// we don't refresh entry position on access because for webhook dedup
// it doesn't matter which old event we drop, only that we drop the
// oldest ones first. Stripe's retries happen within minutes-to-hours
// of the first delivery, so the TTL covers the realistic retry window.
// The cap on size keeps the heap bounded.
//
// Prune: lazy. We don't scan on every call (would be O(N) under high
// webhook volume). Instead we prune when the cache reaches the cap or
// every N calls, whichever comes first.
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

// How often to do a TTL prune in the absence of a cap hit. Keeps prune
// amortized O(1) under steady load.
const PRUNE_EVERY_N_CALLS = 256;

export function createIdempotencyTracker(opts: CreateOpts = {}): IdempotencyTracker {
  const maxEntries = opts.maxEntries ?? 10_000;
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());
  // Map preserves insertion order — front of the map is the
  // oldest insertion, which is what we drop when over the cap.
  const cache = new Map<string, Entry>();
  let callsSincePrune = 0;

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
      // Fail-safe: a missing id is suspicious (Stripe events always have
      // one). Treat it as a duplicate so the caller short-circuits rather
      // than silently bypassing dedup.
      if (!eventId) {
        console.warn("[eventIdempotency] markSeenOnce called with empty id — treating as duplicate (fail-safe)");
        return false;
      }
      callsSincePrune += 1;
      // Lazy prune: only walk the map when there's reason to. Either we
      // hit the prune threshold or we're at/over cap.
      if (callsSincePrune >= PRUNE_EVERY_N_CALLS || cache.size >= maxEntries) {
        prune();
        callsSincePrune = 0;
      }
      // Per-entry TTL check — cheaper than a full prune and ensures
      // correctness without relying on prune cadence.
      const existing = cache.get(eventId);
      const ts = now();
      if (existing && ts - existing.seenAt <= ttlMs) return false;
      cache.set(eventId, { eventId, seenAt: ts });
      // Insertion-order cap — drop the oldest until we're back under the
      // limit. (Not true LRU; that would require delete+set on every hit
      // and we don't need recency for webhook dedup.)
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
      callsSincePrune = 0;
    },
  };
}

// Module-level default — what the Stripe webhook handler uses. Tests
// can spin up isolated trackers via createIdempotencyTracker().
export const stripeWebhookIdempotency: IdempotencyTracker = createIdempotencyTracker();
