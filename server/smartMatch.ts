// T3 — Smart-match subscriptions.
//
// Flat-rate monthly subscription: "give me N matching leads/month". When a new
// lead is ingested we walk through every *active* subscription, score the lead
// against its `filterCriteria`, and (if it matches) automatically deliver the
// lead to the subscriber with the most remaining quota.
//
// Delivery = (a) zero-priced order row stamped with `completed_smartmatch`
// status, (b) lead_assignment row pointing at the agent, (c) decrement the
// subscription's leadsDeliveredThisCycle counter, (d) emit a +5 'purchase'
// reputation event.
//
// The pure helpers (matchesFilter, pickBestSubscription) live here so the
// behaviour can be unit-tested without booting Postgres. The DB side-effect
// (attemptDeliveryForLead) reads/writes through the storage facade.

import { db } from "./db";
import {
  leads,
  orders,
  leadAssignments,
  smartMatchSubscriptions,
  type SmartMatchSubscription,
  type Lead,
} from "@shared/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { storage } from "./storage";
import { recordEvent as recordReputationEvent } from "./reputation";
import { registerCron } from "./lib/cronRegistry";

// ──────────────────────────────────────────────────────
// Public types & constants
// ──────────────────────────────────────────────────────

/**
 * Shape of a smart-match filter. Every criterion is optional; a missing
 * criterion is treated as "anything goes". When multiple criteria are present
 * they're combined with logical AND.
 */
export interface SmartMatchFilter {
  types?: string[];
  states?: string[];
  minMediscore?: number;
  maxPriceCents?: number;
}

/**
 * Pricing tiers for the smart-match plans. Hard-coded in routes & exported
 * here so the test + UI can introspect them.
 */
export const SMART_MATCH_TIERS: ReadonlyArray<{ quota: number; priceCents: number }> = [
  { quota: 25, priceCents: 9900 },
  { quota: 50, priceCents: 17900 },
  { quota: 100, priceCents: 32900 },
] as const;

export const CYCLE_LENGTH_DAYS = 30;

// Shape of the data we need from a lead to evaluate filter matching. Keeping
// it minimal makes the pure tests fast and lets us match against partially
// hydrated payloads in the cron path.
export interface MatchableLead {
  id: number;
  type: string;
  state: string;
  mediscore: number;
  /** Lead.price is a numeric decimal string from drizzle; convert to cents. */
  priceCents: number;
  sold: boolean;
  removed: boolean;
  dncFlagged: boolean;
}

// Shape we need from a subscription. Subset of SmartMatchSubscription so the
// pure helpers don't drag in the full drizzle row type.
export interface MatchableSubscription {
  id: number;
  agentUserId: string;
  status: string;
  monthlyLeadQuota: number;
  leadsDeliveredThisCycle: number;
  filterCriteria: SmartMatchFilter;
}

// ──────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────

/**
 * Convert a drizzle decimal "price" string (e.g. "29.50") into integer cents.
 * Defensive against `null` / NaN — returns 0 so a missing price doesn't
 * silently match a `maxPriceCents` cap.
 */
export function priceToCents(price: string | number | null | undefined): number {
  if (price === null || price === undefined) return 0;
  const n = typeof price === "string" ? parseFloat(price) : price;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Does a lead satisfy every present criterion in the filter? Missing criteria
 * are treated as wildcards. Exported for tests + the cron path.
 */
export function matchesFilter(lead: MatchableLead, filter: SmartMatchFilter): boolean {
  // Sold / removed / DNC leads never count — even if the filter would
  // otherwise match. DNC in particular is a regulatory hard-stop.
  if (lead.sold || lead.removed || lead.dncFlagged) return false;

  if (filter.types && filter.types.length > 0) {
    if (!filter.types.includes(lead.type)) return false;
  }
  if (filter.states && filter.states.length > 0) {
    // Compare uppercased so "fl" in the filter still hits "FL" on the lead.
    const wanted = filter.states.map(s => s.toUpperCase());
    if (!wanted.includes(lead.state.toUpperCase())) return false;
  }
  if (typeof filter.minMediscore === "number") {
    if ((lead.mediscore ?? 0) < filter.minMediscore) return false;
  }
  if (typeof filter.maxPriceCents === "number") {
    if (lead.priceCents > filter.maxPriceCents) return false;
  }
  return true;
}

/**
 * Compute remaining quota for a subscription. Negative values are clamped to
 * 0 to keep downstream math sane in the (defensive) case where over-delivery
 * sneaks past the gate.
 */
export function remainingQuota(sub: Pick<MatchableSubscription, "monthlyLeadQuota" | "leadsDeliveredThisCycle">): number {
  const remaining = sub.monthlyLeadQuota - sub.leadsDeliveredThisCycle;
  return remaining > 0 ? remaining : 0;
}

/**
 * From a candidate pool, pick the subscription that should receive a freshly
 * matched lead. The rules:
 *   1. Subscription must be active.
 *   2. Lead must satisfy filterCriteria.
 *   3. Subscription must have remaining quota (deliveredThisCycle < quota).
 *   4. Of the survivors, pick the one with the *most* remaining quota.
 *      This spreads load so a 25/mo agent doesn't starve a 100/mo agent.
 *   5. Tie-break by subscription id (ascending) for determinism.
 *
 * Exported (and pure!) so smartMatch.test.ts can exercise the full picker
 * without touching Postgres.
 */
export function pickBestSubscription(
  lead: MatchableLead,
  subscriptions: MatchableSubscription[],
): MatchableSubscription | null {
  let best: MatchableSubscription | null = null;
  let bestRemaining = -1;
  for (const sub of subscriptions) {
    if (sub.status !== "active") continue;
    if (!matchesFilter(lead, sub.filterCriteria)) continue;
    const remaining = remainingQuota(sub);
    if (remaining <= 0) continue;
    if (
      remaining > bestRemaining ||
      // Stable tie-break: earlier subscriptions win on a tie. This keeps the
      // picker deterministic in tests and across concurrent calls.
      (remaining === bestRemaining && best !== null && sub.id < best.id)
    ) {
      best = sub;
      bestRemaining = remaining;
    }
  }
  return best;
}

// ──────────────────────────────────────────────────────
// DB-touching delivery path
// ──────────────────────────────────────────────────────

/**
 * Adapter: hydrate the (sparse) shape we need from a full Lead row.
 */
export function leadToMatchable(lead: Lead): MatchableLead {
  return {
    id: lead.id,
    type: lead.type,
    state: lead.state,
    mediscore: lead.mediscore ?? 0,
    priceCents: priceToCents(lead.price as unknown as string),
    sold: lead.sold,
    removed: lead.removed,
    dncFlagged: lead.dncFlagged,
  };
}

/**
 * Adapter: convert a drizzle SmartMatchSubscription row to the subset our
 * picker cares about. Wraps the loose `filterCriteria` jsonb into a typed
 * SmartMatchFilter (defensive — bad shapes downgrade to an empty filter).
 */
export function subscriptionToMatchable(row: SmartMatchSubscription): MatchableSubscription {
  const raw = row.filterCriteria;
  const filter: SmartMatchFilter =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as SmartMatchFilter) : {};
  return {
    id: row.id,
    agentUserId: row.agentUserId,
    status: row.status,
    monthlyLeadQuota: row.monthlyLeadQuota,
    leadsDeliveredThisCycle: row.leadsDeliveredThisCycle,
    filterCriteria: filter,
  };
}

/**
 * Walk through every active subscription, pick the best match for this lead,
 * and deliver it. Returns the assignment row when a delivery happened, or
 * null when nothing matched / no quota was available.
 *
 * This is best-effort: it never throws. Failures are logged so the caller
 * (the vendor ingest handler) can keep its own happy path intact.
 */
export async function attemptDeliveryForLead(lead: Lead): Promise<{
  subscriptionId: number;
  agentUserId: string;
  orderId: number;
} | null> {
  try {
    // Skip leads that are already gone — saves a roundtrip on edge cases
    // where ingest is racing with another flow (e.g. duplicate dedupe).
    if (lead.sold || lead.removed || lead.dncFlagged) return null;
    // Smart-match doesn't grab leads already routed to a specific agent —
    // that path owns the lead end-to-end via routeLeadToBestAgent.
    if (lead.assignedToUserId) return null;

    const subs = await storage.listSmartMatchSubscriptions();
    if (subs.length === 0) return null;

    const matchable = leadToMatchable(lead);
    const candidates = subs.map(subscriptionToMatchable);
    const winner = pickBestSubscription(matchable, candidates);
    if (!winner) return null;

    // Insert order, assignment, mark lead, decrement quota — all inside a
    // single transaction so a half-delivery can never leak into the system.
    const result = await db.transaction(async tx => {
      const [order] = await tx
        .insert(orders)
        .values({
          userId: winner.agentUserId,
          orgId: null,
          leadId: lead.id,
          price: "0",
          status: "completed_smartmatch",
        })
        .returning();

      // lead_assignments.orgId is NOT NULL. Smart-match doesn't always have
      // an org (the subscription is owned by an agent, not an org), so we
      // only emit an assignment audit row when the lead itself has one.
      // The order + lead-update below is sufficient on its own to record
      // the delivery; the assignment row is for org routing audit trails.
      if (lead.orgId) {
        await tx.insert(leadAssignments).values({
          leadId: lead.id,
          orgId: lead.orgId,
          agentUserId: winner.agentUserId,
          matchScore: 100,
          reason: `smart-match:sub=${winner.id}`,
          status: "assigned",
        });
      }

      await tx
        .update(leads)
        .set({ sold: true, soldAt: new Date(), purchasedBy: winner.agentUserId, assignedToUserId: winner.agentUserId, assignedAt: new Date() })
        .where(eq(leads.id, lead.id));

      await tx
        .update(smartMatchSubscriptions)
        .set({ leadsDeliveredThisCycle: sql`${smartMatchSubscriptions.leadsDeliveredThisCycle} + 1` })
        .where(eq(smartMatchSubscriptions.id, winner.id));

      return { orderId: order.id };
    });

    // Reputation event fires outside the transaction so a reputation hiccup
    // can never roll back a real delivery.
    await recordReputationEvent({
      agentUserId: winner.agentUserId,
      eventType: "purchase",
      relatedLeadId: lead.id,
      metadata: { source: "smart_match", subscriptionId: winner.id },
    });

    return {
      subscriptionId: winner.id,
      agentUserId: winner.agentUserId,
      orderId: result.orderId,
    };
  } catch (err: any) {
    console.error("[smart-match] delivery error", { leadId: lead.id, err: err?.message });
    return null;
  }
}

// ──────────────────────────────────────────────────────
// Cycle reset cron
// ──────────────────────────────────────────────────────

/**
 * Reset any subscription whose cycle started >= CYCLE_LENGTH_DAYS ago:
 * zero the delivered counter, bump cyclesDelivered, restart the clock.
 * Exported so tests / admin tooling can fire it directly.
 */
export async function runSmartMatchCycleReset(): Promise<{ resetCount: number }> {
  const cutoff = new Date(Date.now() - CYCLE_LENGTH_DAYS * 24 * 60 * 60 * 1000);
  const stale = await db
    .select()
    .from(smartMatchSubscriptions)
    .where(
      and(
        eq(smartMatchSubscriptions.status, "active"),
        lt(smartMatchSubscriptions.cycleStartedAt, cutoff),
      ),
    );
  for (const sub of stale) {
    await db
      .update(smartMatchSubscriptions)
      .set({
        leadsDeliveredThisCycle: 0,
        cyclesDelivered: sql`${smartMatchSubscriptions.cyclesDelivered} + 1`,
        cycleStartedAt: new Date(),
      })
      .where(eq(smartMatchSubscriptions.id, sub.id));
  }
  if (stale.length > 0) {
    console.log(`[smart-match] cycle-reset: ${stale.length} subscriptions rolled over`);
  }
  return { resetCount: stale.length };
}

export function startSmartMatchCycleCron(): void {
  // 02:00 every day. Sits before dnc-recheck (02:30) so any newly-eligible
  // subscriptions can pick up freshly-rechecked leads on the same day.
  registerCron({
    name: "smart-match-cycle-reset",
    schedule: "0 2 * * *",
    fn: async () => {
      await runSmartMatchCycleReset();
    },
  });
}
