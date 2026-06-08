// Agent reputation system.
//
// We append immutable rows to `agent_reputation_events` whenever an agent does
// something the platform cares about (accepts/declines an assignment, buys a
// lead, gets a dispute filed/approved against them, K4's CRM "deal_closed"
// event, etc). The reputation _score_ is then a derived aggregate over a
// trailing 90-day window — never stored, always recomputed. That keeps the
// historical event stream the single source of truth and lets us replay or
// tweak weights without a backfill.
//
// Why this lives in its own file rather than inside storage.ts:
//   1. The pure aggregation helpers (clamp, weighting) are trivially testable
//      without touching Postgres.
//   2. recordEvent is best-effort and must never block the main action, so it
//      lives behind a try/catch wrapper that the storage methods can `await`
//      inline without worrying about failures bubbling up.
//
// Top-agents endpoint (used by org admins to surface reputation rankings)
// applies a "verified + 3+ events" filter so we never lionize an unverified
// agent or one with a single lucky data point.

import { db } from "./db";
import { agentReputationEvents, agentProfiles, users } from "@shared/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { log } from "./logger";

// ──────────────────────────────────────────────────────
// Weight table — exported so tests + the dashboard can introspect it.
//
// Tuned so that a single approved dispute (-5) wipes a purchase (+5), and a
// declined assignment is a small nudge rather than a hammer. Weights live in
// code (not the DB) so they can be A/B'd without a schema change.
// ──────────────────────────────────────────────────────
export const REPUTATION_WEIGHTS = {
  accepted_assignment: 2,
  declined_assignment: -1,
  purchase: 5,
  // K4 owns this one — we tolerate the type but never write it ourselves.
  crm_deal_closed: 8,
  // Buyer files a dispute on a lead the agent purchased.
  dispute_filed_against: -3,
  // Admin approves that dispute → bigger hit on top of the filing.
  dispute_approved: -5,
  // Reserved for future fast-response bonus.
  response_time_under_5m: 1,
} as const;

export type ReputationEventType = keyof typeof REPUTATION_WEIGHTS;

export const REPUTATION_SCORE_MIN = -50;
export const REPUTATION_SCORE_MAX = 100;
export const REPUTATION_WINDOW_DAYS = 90;
export const TOP_AGENT_MIN_EVENTS = 3;

export interface RecordEventInput {
  agentUserId: string;
  eventType: ReputationEventType;
  relatedLeadId?: number | null;
  metadata?: Record<string, unknown>;
  // Optional weight override — defaults to the table above. Useful when a
  // caller wants to scale by severity (e.g. dispute over a high-value lead).
  weight?: number;
}

/**
 * Pure clamp helper. Exported for tests.
 */
export function clampReputationScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw < REPUTATION_SCORE_MIN) return REPUTATION_SCORE_MIN;
  if (raw > REPUTATION_SCORE_MAX) return REPUTATION_SCORE_MAX;
  return Math.round(raw);
}

/**
 * Pure aggregator. Sums an array of {weight, createdAt} events that fall
 * within the trailing window, then clamps. Exported so the unit tests can
 * exercise it without touching the DB.
 */
export function aggregateEvents(
  events: { weight: number; createdAt: Date | null }[],
  now: Date = new Date(),
  windowDays: number = REPUTATION_WINDOW_DAYS,
): number {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  let sum = 0;
  for (const e of events) {
    if (!e.createdAt) continue;
    if (e.createdAt.getTime() < cutoff) continue;
    sum += e.weight;
  }
  return clampReputationScore(sum);
}

/**
 * Append a reputation event. Never throws — failures are logged and swallowed
 * so this can be safely awaited inside the storage transactions without
 * risking the user's action being rolled back over a reputation hiccup.
 */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  try {
    const weight = input.weight ?? REPUTATION_WEIGHTS[input.eventType];
    if (typeof weight !== "number") {
      log.warn("[reputation] unknown event type", { eventType: input.eventType });
      return;
    }
    await db.insert(agentReputationEvents).values({
      agentUserId: input.agentUserId,
      eventType: input.eventType,
      weight,
      relatedLeadId: input.relatedLeadId ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    // Swallow — reputation is best-effort by design.
    log.error("[reputation] recordEvent failed", { err: String(err), input: JSON.stringify(input) });
  }
}

/**
 * Roll up an agent's reputation score over the trailing window. Returns 0 if
 * the agent has no events at all. Clamped to [-50, 100].
 */
export async function computeReputationScore(agentUserId: string): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - REPUTATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${agentReputationEvents.weight}), 0)`.as("total") })
      .from(agentReputationEvents)
      .where(
        and(
          eq(agentReputationEvents.agentUserId, agentUserId),
          gte(agentReputationEvents.createdAt, cutoff),
        ),
      );
    const total = Number(row?.total ?? 0);
    return clampReputationScore(total);
  } catch (err) {
    log.error("[reputation] computeReputationScore failed", { err: String(err), agentUserId });
    return 0;
  }
}

export interface TopAgent {
  agentUserId: string;
  reputationScore: number;
  eventCount: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

/**
 * Top agents for an org by reputation. We require:
 *   - the agent has a verified profile in this org
 *   - the agent has at least TOP_AGENT_MIN_EVENTS reputation events in the window
 *
 * This protects against noisy early-career signal — one declined assignment
 * shouldn't put a brand-new agent at -1 on a leaderboard.
 */
export async function getTopAgentsForOrg(
  orgId: string,
  limit: number = 10,
): Promise<TopAgent[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 10));
  const cutoff = new Date(Date.now() - REPUTATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Single SQL aggregate: join verified agents in this org with their events
  // (filtered to the trailing window), group, filter on event-count threshold,
  // sort by clamped score. Clamping happens in JS after the read so the
  // weight table stays the single source of truth.
  const rows = await db
    .select({
      agentUserId: agentProfiles.userId,
      total: sql<number>`coalesce(sum(${agentReputationEvents.weight}), 0)`.as("total"),
      eventCount: sql<number>`count(${agentReputationEvents.id})`.as("event_count"),
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(agentProfiles)
    .leftJoin(
      agentReputationEvents,
      and(
        eq(agentReputationEvents.agentUserId, agentProfiles.userId),
        gte(agentReputationEvents.createdAt, cutoff),
      ),
    )
    .leftJoin(users, eq(users.id, agentProfiles.userId))
    .where(
      and(
        eq(agentProfiles.orgId, orgId),
        eq(agentProfiles.verificationStatus, "verified"),
      ),
    )
    .groupBy(agentProfiles.userId, users.firstName, users.lastName, users.email)
    .having(sql`count(${agentReputationEvents.id}) >= ${TOP_AGENT_MIN_EVENTS}`)
    .orderBy(desc(sql`coalesce(sum(${agentReputationEvents.weight}), 0)`))
    .limit(safeLimit);

  return rows.map(r => ({
    agentUserId: r.agentUserId,
    reputationScore: clampReputationScore(Number(r.total ?? 0)),
    eventCount: Number(r.eventCount ?? 0),
    firstName: r.firstName ?? null,
    lastName: r.lastName ?? null,
    email: r.email ?? null,
  }));
}
