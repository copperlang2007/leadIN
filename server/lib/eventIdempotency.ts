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

// CRM reputation-event dedup. Key = `${provider}:${externalId}` so the
// same provider deal can't fire +10 rep events on every replay. Same
// trade-off as the Stripe one — per-process; multi-pod hardening is a
// shared follow-up. Sized smaller because rep events are lower volume.
export const crmReputationIdempotency: IdempotencyTracker = createIdempotencyTracker({
  maxEntries: 2_000,
});

// ──────────────────────────────────────────────────────────────────────
// DB-backed idempotency. The in-memory trackers above only dedup within
// a single process; multi-pod deploys can re-fire side effects when the
// same webhook event lands on a different replica. markSeenOnceDb
// writes to webhook_idempotency with ON CONFLICT DO NOTHING — the
// DB's unique constraint gives us atomic cross-pod dedup.
//
// Failure mode: if the DB is briefly unreachable, we fall back to the
// in-memory tracker and return true (process the event). The
// downstream side effects must be designed to tolerate the rare
// double-fire across pods. This matches Stripe's own retry contract.
// ──────────────────────────────────────────────────────────────────────

import { webhookIdempotency } from "@shared/schema";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface DbIdempotencyDeps {
  // Subset of the drizzle db we need. Typed loosely so tests can pass
  // a stub without booting the full schema.
  insert: NodePgDatabase<any>["insert"];
}

// Lazy db import so this module can be loaded without DATABASE_URL set
// (the in-memory exports above are still useful in tests).
let dbRef: DbIdempotencyDeps | null = null;
async function getDb(): Promise<DbIdempotencyDeps> {
  if (dbRef) return dbRef;
  const mod = await import("../db.js");
  dbRef = mod.db as unknown as DbIdempotencyDeps;
  return dbRef;
}

/** Test-only — inject a mocked db. Returns a reset fn. */
export function __setIdempotencyDbForTesting(db: DbIdempotencyDeps | null): () => void {
  const prev = dbRef;
  dbRef = db;
  return () => {
    dbRef = prev;
  };
}

/**
 * Atomic cross-pod dedup. Returns true if this is the first time
 * `(source, key)` was seen, false on duplicate. The DB's unique
 * constraint is the source of truth; the in-memory tracker passed in
 * via `fallbackTracker` is a hot path optimisation that short-circuits
 * the round-trip for events we've already seen on THIS pod.
 *
 * On DB error we return true (process the event) and log via the
 * caller — duplicate processing on rare DB blips is preferable to
 * silently dropping legitimate events.
 */
export async function markSeenOnceDb(
  source: string,
  key: string,
  fallbackTracker?: IdempotencyTracker,
): Promise<boolean> {
  if (!key) {
    console.warn("[idempotencyDb] markSeenOnceDb called with empty key — treating as duplicate (fail-safe)");
    return false;
  }

  // Hot path: if we've already seen it on this pod, skip the round-trip.
  if (fallbackTracker && !fallbackTracker.markSeenOnce(`${source}:${key}`)) {
    return false;
  }

  try {
    const db = await getDb();
    // ON CONFLICT DO NOTHING + .returning() lets us tell new from duplicate
    // by checking rowCount. Drizzle returns the inserted row(s) only when
    // the INSERT actually fired.
    const result = await db
      .insert(webhookIdempotency)
      .values({ source, key })
      .onConflictDoNothing({ target: [webhookIdempotency.source, webhookIdempotency.key] })
      .returning({ source: webhookIdempotency.source });
    return result.length > 0;
  } catch (err) {
    // DB hiccup — we already passed the in-memory check, so allow the
    // event through. Log so operators can see DB problems clearly.
    console.error("[idempotencyDb] DB write failed, allowing event through:", err);
    return true;
  }
}

/**
 * Prune rows older than `olderThanMs`. Call from a cron to keep the
 * table from growing unbounded — once an event is more than ~24h old,
 * upstream retries will have stopped.
 */
export async function pruneOldIdempotencyRows(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - olderThanMs);
    const db = await getDb();
    const result = (await (db as any)
      .delete(webhookIdempotency)
      .where(sql`${webhookIdempotency.seenAt} < ${cutoff}`)
      .returning({ source: webhookIdempotency.source })) as Array<{ source: string }>;
    return result.length;
  } catch (err) {
    console.error("[idempotencyDb] prune failed:", err);
    return 0;
  }
}
