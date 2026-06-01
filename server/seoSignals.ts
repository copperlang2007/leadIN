// SEO keyword signals — pulled from Google Search Console (if a service-account
// key is configured) or DataForSEO's free-tier keyword endpoint. When neither
// integration is configured the module seeds a deterministic baseline set so
// the content engine still has data to drive topic prioritization.

import { db } from "./db";
import { keywordSignals } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";
import { registerCron } from "./lib/cronRegistry";
import { withAdvisoryLock } from "./lib/lock";

const SEED_KEYWORDS = [
  { keyword: "medicare advantage 2026", category: "Medicare Advantage" },
  { keyword: "medicare supplement plan g cost", category: "Medicare Supplement" },
  { keyword: "best medicare advantage plans florida", category: "Medicare Advantage" },
  { keyword: "final expense insurance no exam", category: "Final Expense" },
  { keyword: "medicare part d cost", category: "Medicare Advantage" },
  { keyword: "plan g vs plan n", category: "Medicare Supplement" },
  { keyword: "medicare aep dates", category: "Industry News" },
  { keyword: "burial insurance quotes", category: "Final Expense" },
  { keyword: "humana medicare advantage reviews", category: "Medicare Advantage" },
  { keyword: "aetna part d formulary", category: "Medicare Advantage" },
];

function opportunityScore(impressions: number, clicks: number, position: number): number {
  // Classic "low-hanging fruit": high impressions, low CTR, position 4-15.
  if (impressions < 10) return Math.min(100, Math.round(impressions));
  const ctr = clicks / impressions;
  const positionBonus = position >= 4 && position <= 15 ? 30 : position < 4 ? 5 : 10;
  const demandBonus = Math.min(40, Math.round(Math.log10(impressions + 1) * 12));
  const headroomBonus = Math.min(30, Math.round((0.1 - Math.min(ctr, 0.1)) * 300));
  return Math.max(0, Math.min(100, positionBonus + demandBonus + headroomBonus));
}

async function fetchFromGSC(): Promise<Array<{ keyword: string; impressions: number; clicks: number; position: number; category?: string }>> {
  const siteUrl = process.env.GSC_SITE_URL;
  const apiKey = process.env.GSC_API_KEY;
  if (!siteUrl || !apiKey) return [];

  const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  try {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate, endDate,
        dimensions: ["query"],
        rowLimit: 200,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[seo] GSC returned ${res.status}`);
      return [];
    }
    const body: any = await res.json();
    return (body.rows ?? []).map((r: any) => ({
      keyword: String(r.keys?.[0] ?? ""),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      position: Number(r.position ?? 0),
    }));
  } catch (err: any) {
    console.warn("[seo] GSC fetch failed:", err?.message);
    return [];
  }
}

async function fetchFromDataForSEO(): Promise<Array<{ keyword: string; impressions: number; clicks: number; position: number; category?: string }>> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return [];

  try {
    const auth = Buffer.from(`${login}:${password}`).toString("base64");
    const res = await fetch("https://api.dataforseo.com/v3/keywords_data/google/search_volume/live", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keywords: SEED_KEYWORDS.map(s => s.keyword), language_code: "en", location_code: 2840 }]),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const body: any = await res.json();
    const items: any[] = body?.tasks?.[0]?.result ?? [];
    return items.map(i => ({
      keyword: String(i.keyword),
      impressions: Number(i.search_volume ?? 0),
      clicks: 0,
      position: 20,
    }));
  } catch (err: any) {
    console.warn("[seo] DataForSEO fetch failed:", err?.message);
    return [];
  }
}

export async function refreshKeywordSignals(): Promise<{ count: number; source: string }> {
  let rows = await fetchFromGSC();
  let source: "gsc" | "dataforseo" | "seed" = "gsc";
  if (rows.length === 0) {
    rows = await fetchFromDataForSEO();
    source = "dataforseo";
  }
  if (rows.length === 0) {
    rows = SEED_KEYWORDS.map(s => ({
      keyword: s.keyword,
      impressions: 500 + Math.floor(Math.random() * 2000),
      clicks: 5 + Math.floor(Math.random() * 50),
      position: 4 + Math.random() * 12,
      category: s.category,
    }));
    source = "seed";
  }

  for (const r of rows) {
    const score = opportunityScore(r.impressions, r.clicks, r.position);
    const category = (r as any).category ?? inferCategory(r.keyword);
    await db
      .insert(keywordSignals)
      .values({
        keyword: r.keyword,
        source,
        impressions: r.impressions,
        clicks: r.clicks,
        position: r.position.toFixed(2),
        opportunityScore: score,
        category,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [keywordSignals.keyword, keywordSignals.source],
        set: {
          impressions: r.impressions,
          clicks: r.clicks,
          position: r.position.toFixed(2),
          opportunityScore: score,
          category,
          fetchedAt: new Date(),
        },
      });
  }

  console.log(`[seo] refreshed ${rows.length} keyword signals from ${source}`);
  return { count: rows.length, source };
}

function inferCategory(keyword: string): string {
  const k = keyword.toLowerCase();
  if (k.includes("supplement") || k.includes("medigap") || /plan [a-n]\b/.test(k)) return "Medicare Supplement";
  if (k.includes("final expense") || k.includes("burial")) return "Final Expense";
  if (k.includes("aep") || k.includes("compliance") || k.includes("tcpa")) return "Industry News";
  return "Medicare Advantage";
}

export async function getTopOpportunityKeywords(limit = 10) {
  return db
    .select()
    .from(keywordSignals)
    .orderBy(desc(keywordSignals.opportunityScore))
    .limit(limit);
}

export function startSeoSignalCron(): void {
  // Refresh once a day at 03:00 to keep signals fresh for the content engine.
  registerCron({
    name: "seo-keyword-refresh",
    schedule: "0 3 * * *",
    fn: async () => { await refreshKeywordSignals(); },
  });

  // Warm the table on startup if it's empty. Wrap in an advisory lock so only
  // one instance does the seed when multi-process deploys boot together.
  (async () => {
    await withAdvisoryLock("seo-bootstrap", async () => {
      const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(keywordSignals);
      if (!row || Number(row.c ?? 0) === 0) {
        await refreshKeywordSignals().catch(err => console.error("[seo] warm failed:", err));
      }
    });
  })();
}
