// Funnel + activation analytics built on top of behavioral_events and orders.
// Pure read-only aggregations. Admin-only.

import { db } from "./db";
import { behavioralEvents, leads, orders, organizations, agentProfiles } from "@shared/schema";
import { and, eq, gte, sql, count, countDistinct } from "drizzle-orm";

export interface FunnelSnapshot {
  windowStart: string;
  windowEnd: string;
  // Acquisition
  uniqueSessions: number;
  uniqueAuthenticatedUsers: number;
  pageViews: number;
  // Engagement
  marketplaceVisitors: number;
  deepScrollers: number;     // sessions hitting 75%+ scroll on any page
  toolInteractors: number;   // sessions firing tool_interaction
  // Conversion
  ctaClickers: number;
  purchasers: number;
  // Activation (downstream signals)
  newOrgs: number;
  newAgents: number;
  verifiedAgents: number;
  // Revenue
  ordersCount: number;
  revenueUsd: string;
  // Ratios
  visitorToCtaPct: number;
  ctaToPurchasePct: number;
  visitorToPurchasePct: number;
}

export async function getFunnelSnapshot(days = 7): Promise<FunnelSnapshot> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Distinct sessions, page views, scroll, tool, cta within the window.
  const [pvRow] = await db
    .select({ pv: count(), sess: countDistinct(behavioralEvents.sessionId) })
    .from(behavioralEvents)
    .where(and(eq(behavioralEvents.eventType, "page_view"), gte(behavioralEvents.createdAt, since)));

  const [authSessRow] = await db
    .select({ users: countDistinct(behavioralEvents.userId) })
    .from(behavioralEvents)
    .where(and(gte(behavioralEvents.createdAt, since), sql`${behavioralEvents.userId} IS NOT NULL`));

  const [marketRow] = await db
    .select({ sess: countDistinct(behavioralEvents.sessionId) })
    .from(behavioralEvents)
    .where(and(
      eq(behavioralEvents.eventType, "page_view"),
      gte(behavioralEvents.createdAt, since),
      sql`${behavioralEvents.path} = '/' OR ${behavioralEvents.path} LIKE '/?%'`,
    ));

  const [deepRow] = await db
    .select({ sess: countDistinct(behavioralEvents.sessionId) })
    .from(behavioralEvents)
    .where(and(
      eq(behavioralEvents.eventType, "scroll_depth"),
      gte(behavioralEvents.createdAt, since),
      sql`${behavioralEvents.value} >= 75`,
    ));

  const [toolRow] = await db
    .select({ sess: countDistinct(behavioralEvents.sessionId) })
    .from(behavioralEvents)
    .where(and(eq(behavioralEvents.eventType, "tool_interaction"), gte(behavioralEvents.createdAt, since)));

  const [ctaRow] = await db
    .select({ sess: countDistinct(behavioralEvents.sessionId) })
    .from(behavioralEvents)
    .where(and(eq(behavioralEvents.eventType, "cta_click"), gte(behavioralEvents.createdAt, since)));

  const [orderRow] = await db
    .select({ c: count(), users: countDistinct(orders.userId), total: sql<string>`COALESCE(SUM(${orders.price}::numeric), 0)::text` })
    .from(orders)
    .where(gte(orders.createdAt, since));

  const [orgRow] = await db
    .select({ c: count() })
    .from(organizations)
    .where(gte(organizations.createdAt, since));

  const [agentRow] = await db
    .select({ c: count() })
    .from(agentProfiles)
    .where(gte(agentProfiles.createdAt, since));

  const [verifiedRow] = await db
    .select({ c: count() })
    .from(agentProfiles)
    .where(and(gte(agentProfiles.createdAt, since), eq(agentProfiles.verificationStatus, "verified")));

  const uniqueSessions = Number(pvRow?.sess ?? 0);
  const ctaClickers = Number(ctaRow?.sess ?? 0);
  const purchasers = Number(orderRow?.users ?? 0);
  const marketplaceVisitors = Number(marketRow?.sess ?? 0);

  const pct = (num: number, denom: number) => denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

  return {
    windowStart: since.toISOString(),
    windowEnd: new Date().toISOString(),
    uniqueSessions,
    uniqueAuthenticatedUsers: Number(authSessRow?.users ?? 0),
    pageViews: Number(pvRow?.pv ?? 0),
    marketplaceVisitors,
    deepScrollers: Number(deepRow?.sess ?? 0),
    toolInteractors: Number(toolRow?.sess ?? 0),
    ctaClickers,
    purchasers,
    newOrgs: Number(orgRow?.c ?? 0),
    newAgents: Number(agentRow?.c ?? 0),
    verifiedAgents: Number(verifiedRow?.c ?? 0),
    ordersCount: Number(orderRow?.c ?? 0),
    revenueUsd: String(orderRow?.total ?? "0"),
    visitorToCtaPct: pct(ctaClickers, marketplaceVisitors),
    ctaToPurchasePct: pct(purchasers, ctaClickers),
    visitorToPurchasePct: pct(purchasers, marketplaceVisitors),
  };
}

export interface LeadAnalytics {
  topMediscoreBucket: { bucket: string; count: number }[];
  dncRate: { flagged: number; clean: number; pct: number };
  conversionByType: { type: string; available: number; sold: number; pct: number }[];
}

export async function getLeadAnalytics(): Promise<LeadAnalytics> {
  // MediScore distribution buckets (0-25, 26-50, 51-75, 76-100)
  const bucketRows = await db.execute<{ bucket: string; count: number }>(sql`
    SELECT
      CASE
        WHEN mediscore <= 25 THEN '0-25'
        WHEN mediscore <= 50 THEN '26-50'
        WHEN mediscore <= 75 THEN '51-75'
        ELSE '76-100'
      END AS bucket,
      COUNT(*)::int AS count
    FROM leads
    WHERE removed = false
    GROUP BY bucket
    ORDER BY bucket
  `);

  const [dncRow] = await db
    .select({
      flagged: sql<number>`COUNT(*) FILTER (WHERE ${leads.dncFlagged} = true)::int`,
      clean: sql<number>`COUNT(*) FILTER (WHERE ${leads.dncFlagged} = false)::int`,
    })
    .from(leads)
    .where(eq(leads.removed, false));

  const flagged = Number(dncRow?.flagged ?? 0);
  const clean = Number(dncRow?.clean ?? 0);
  const total = flagged + clean;

  const convRows = await db
    .select({
      type: leads.type,
      total: count(),
      sold: sql<number>`COUNT(*) FILTER (WHERE ${leads.sold} = true)::int`,
    })
    .from(leads)
    .where(eq(leads.removed, false))
    .groupBy(leads.type);

  return {
    topMediscoreBucket: ((bucketRows as any).rows ?? bucketRows).map((r: any) => ({ bucket: r.bucket, count: Number(r.count) })),
    dncRate: {
      flagged,
      clean,
      pct: total > 0 ? Math.round((flagged / total) * 1000) / 10 : 0,
    },
    conversionByType: convRows.map(r => ({
      type: r.type,
      available: Number(r.total) - Number(r.sold),
      sold: Number(r.sold),
      pct: Number(r.total) > 0 ? Math.round((Number(r.sold) / Number(r.total)) * 1000) / 10 : 0,
    })),
  };
}
