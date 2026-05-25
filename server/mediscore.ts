// MediScore: aggregates 20+ deterministic signals into a 0-100 lead-quality
// score. Each signal contributes a labelled, weighted component so the UI can
// surface the breakdown (active_signals count) for buyers.

import { db } from "./db";
import { eq, and, gte, sql } from "drizzle-orm";
import { leads, cmsPlanSignals, behavioralEvents, keywordSignals } from "@shared/schema";

export interface MediScoreSignal {
  key: string;
  label: string;
  weight: number; // points contributed (positive or negative)
  hit: boolean;
}

export interface MediScoreBreakdown {
  score: number; // 0..100
  activeSignalCount: number;
  signals: MediScoreSignal[];
  computedAt: string;
}

// 20+ signal definitions. Each must produce a boolean `hit` against the
// available data sources. Weights sum well past 100 — final score is clamped.
const SIGNAL_DEFS = [
  { key: "verified",            label: "Vendor verified",                weight: 8 },
  { key: "tcpa_consent",        label: "TCPA consent on file",           weight: 7 },
  { key: "exclusive",           label: "Exclusive lead",                 weight: 6 },
  { key: "fresh_lead",          label: "Ingested within 24h",            weight: 5 },
  { key: "phone_present",       label: "Phone number present",           weight: 4 },
  { key: "email_present",       label: "Email present",                  weight: 3 },
  { key: "address_present",     label: "Address present",                weight: 3 },
  { key: "age_in_window",       label: "Age 60-80 (Medicare window)",    weight: 6 },
  { key: "homeowner",           label: "Homeowner",                      weight: 3 },
  { key: "income_qualified",    label: "Income $25k+",                   weight: 3 },
  { key: "non_smoker",          label: "Non-smoker",                     weight: 2 },
  { key: "no_condition",        label: "No flagged condition",           weight: 2 },
  { key: "premium_source",      label: "Premium acquisition source",     weight: 6 },
  { key: "dnc_clean",           label: "Not on DNC list",                weight: 10 },
  { key: "cms_termination",     label: "Plan termination in county",     weight: 7 },
  { key: "cms_benefit_change",  label: "Recent benefit change",          weight: 5 },
  { key: "cms_star_drop",       label: "Carrier star rating drop",       weight: 6 },
  { key: "behavior_dwell",      label: "Strong dwell time (>60s)",       weight: 4 },
  { key: "behavior_scroll",     label: "Deep scroll (>75%)",             weight: 3 },
  { key: "behavior_cta",        label: "Clicked CTA",                    weight: 5 },
  { key: "behavior_tool",       label: "Used compatibility tool",        weight: 4 },
  { key: "seo_demand",          label: "High-demand SEO topic match",    weight: 3 },
] as const;

type SignalKey = (typeof SIGNAL_DEFS)[number]["key"];

const PREMIUM_SOURCES = new Set(["Call Center Transfer", "Organic Search"]);

export async function computeMediScore(leadId: number): Promise<MediScoreBreakdown> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const provenance: any[] = Array.isArray(lead.provenance) ? (lead.provenance as any[]) : [];
  const hasTcpa = provenance.some(p => /tcpa/i.test(p?.action ?? "") || /TrustedForm|Jornaya/i.test(p?.actor ?? ""));

  // Pull external signals in parallel
  const [cmsRows, eventRows, kwRows] = await Promise.all([
    db.select().from(cmsPlanSignals).where(eq(cmsPlanSignals.state, lead.state)),
    lead.sessionId
      ? db.select().from(behavioralEvents).where(eq(behavioralEvents.sessionId, lead.sessionId))
      : Promise.resolve([] as any[]),
    db
      .select()
      .from(keywordSignals)
      .where(sql`${keywordSignals.opportunityScore} >= 70`)
      .limit(50),
  ]);

  const cmsTermination = cmsRows.some(c => c.signalType === "termination");
  const cmsBenefit = cmsRows.some(c => c.signalType === "benefit_change");
  const cmsStarDrop = cmsRows.some(c => c.signalType === "star_rating" && parseFloat(c.starRating ?? "5") < 3.5);

  // Behavior aggregates
  let maxScroll = 0;
  let maxDwell = 0;
  let ctaClicks = 0;
  let toolUses = 0;
  for (const e of eventRows) {
    if (e.eventType === "scroll_depth") maxScroll = Math.max(maxScroll, e.value ?? 0);
    else if (e.eventType === "time_on_page") maxDwell = Math.max(maxDwell, e.value ?? 0);
    else if (e.eventType === "cta_click") ctaClicks += 1;
    else if (e.eventType === "tool_interaction") toolUses += 1;
  }

  const seoMatch = kwRows.some(k =>
    (k.category ?? "").toLowerCase().includes(lead.type.toLowerCase().split(" ")[0]) ||
    k.keyword.toLowerCase().includes(lead.type.toLowerCase().split(" ")[0]),
  );

  const ageHours = lead.createdAt
    ? (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60)
    : 99;

  const incomeQualified = (lead.income ?? "").includes("$25k") || (lead.income ?? "").includes("$50k+");

  const hits: Record<SignalKey, boolean> = {
    verified: !!lead.verified,
    tcpa_consent: hasTcpa,
    exclusive: lead.exclusivity === "Exclusive",
    fresh_lead: ageHours <= 24,
    phone_present: !!lead.consumerPhone,
    email_present: !!lead.consumerEmail,
    address_present: !!lead.consumerAddress,
    age_in_window: lead.consumerAge >= 60 && lead.consumerAge <= 80,
    homeowner: lead.homeowner === true,
    income_qualified: incomeQualified,
    non_smoker: lead.smoker === false,
    no_condition: lead.hasCondition === false,
    premium_source: PREMIUM_SOURCES.has(lead.source),
    dnc_clean: !lead.dncFlagged,
    cms_termination: cmsTermination,
    cms_benefit_change: cmsBenefit,
    cms_star_drop: cmsStarDrop,
    behavior_dwell: maxDwell >= 60,
    behavior_scroll: maxScroll >= 75,
    behavior_cta: ctaClicks > 0,
    behavior_tool: toolUses > 0,
    seo_demand: seoMatch,
  };

  const signals: MediScoreSignal[] = SIGNAL_DEFS.map(def => ({
    key: def.key,
    label: def.label,
    weight: def.weight,
    hit: hits[def.key as SignalKey] ?? false,
  }));

  const earned = signals.filter(s => s.hit).reduce((a, s) => a + s.weight, 0);
  const denominator = SIGNAL_DEFS.reduce((a, s) => a + s.weight, 0);
  const score = Math.min(100, Math.round((earned / denominator) * 100));
  const activeSignalCount = signals.filter(s => s.hit).length;

  return { score, activeSignalCount, signals, computedAt: new Date().toISOString() };
}

export async function recomputeAndPersistMediScore(leadId: number): Promise<MediScoreBreakdown> {
  const breakdown = await computeMediScore(leadId);
  await db
    .update(leads)
    .set({
      mediscore: breakdown.score,
      mediscoreSignals: breakdown as any,
    })
    .where(eq(leads.id, leadId));
  return breakdown;
}
