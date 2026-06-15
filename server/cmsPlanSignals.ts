// CMS Plan Finder public-data parser.
//
// CMS publishes annual files for Medicare Advantage / Part D plans:
//   – Plan Crosswalk (terminations + consolidations)
//   – Star Ratings
//   – Plan Benefits Package change notices
//
// Downloads are large and the public URLs change yearly. To keep this module
// runnable without network access we accept three optional env vars
// (CMS_TERMINATIONS_URL, CMS_STAR_RATINGS_URL, CMS_BENEFIT_CHANGES_URL) and
// fall back to a small representative seed set so MediScore always has
// data to consume. Real production use should point those env vars at the
// official CMS file URLs (or a mirror) and the parser will populate the table.

import { db } from "./db";
import { cmsPlanSignals } from "@shared/schema";
import { sql } from "drizzle-orm";
import { registerCron } from "./lib/cronRegistry";
import { withAdvisoryLock } from "./lib/lock";
import { logError } from "./lib/safeError";

const FALLBACK_SEED = [
  { planId: "H1234-001", carrier: "Humana", state: "FL", county: "Miami-Dade", signalType: "termination", starRating: null,  effectiveDate: new Date("2026-01-01") },
  { planId: "H5678-002", carrier: "UnitedHealthcare", state: "TX", county: "Harris", signalType: "benefit_change", starRating: null, effectiveDate: new Date("2026-01-01") },
  { planId: "H9012-003", carrier: "Aetna", state: "CA", county: "Los Angeles", signalType: "star_rating", starRating: "3.0", effectiveDate: new Date("2026-01-01") },
  { planId: "H3456-001", carrier: "Cigna", state: "AZ", county: "Maricopa", signalType: "star_rating", starRating: "2.5", effectiveDate: new Date("2026-01-01") },
  { planId: "H7890-005", carrier: "Anthem BCBS", state: "NC", county: "Mecklenburg", signalType: "termination", starRating: null, effectiveDate: new Date("2026-01-01") },
];

// RFC-4180-style quote-aware CSV parser. Handles quoted fields with embedded
// commas, newlines, and escaped double quotes ("").
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* swallow */ }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.length > 0));
}

async function parseCsv(url: string): Promise<string[][]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`CMS download ${url} → ${res.status}`);
  const text = await res.text();
  return parseCsvText(text);
}

async function ingestTerminations(url: string) {
  const rows = await parseCsv(url);
  // Header detection — skip the first row if it looks like a header
  const dataRows = /[a-z]/i.test(rows[0]?.[0] ?? "") && !/^H\d/i.test(rows[0]?.[0] ?? "") ? rows.slice(1) : rows;
  for (const cols of dataRows) {
    // Expect: contract_id, plan_id, carrier, state, county, effective_date
    const [contractId, planId, carrier, state, county, eff] = cols;
    if (!contractId || !state) continue;
    await db
      .insert(cmsPlanSignals)
      .values({
        planId: `${contractId}-${planId ?? "000"}`,
        carrier: carrier?.trim(),
        state: state.trim().slice(0, 2).toUpperCase(),
        county: county?.trim(),
        signalType: "termination",
        effectiveDate: eff ? new Date(eff) : null,
        details: { source: "cms_terminations_csv" },
      })
      .onConflictDoNothing();
  }
}

async function ingestStarRatings(url: string) {
  const rows = await parseCsv(url);
  const dataRows = rows.slice(1);
  for (const cols of dataRows) {
    const [contractId, planId, carrier, state, rating] = cols;
    if (!contractId || !state || !rating) continue;
    await db
      .insert(cmsPlanSignals)
      .values({
        planId: `${contractId}-${planId ?? "000"}`,
        carrier: carrier?.trim(),
        state: state.trim().slice(0, 2).toUpperCase(),
        signalType: "star_rating",
        starRating: rating.trim(),
        effectiveDate: new Date(`${new Date().getFullYear()}-01-01`),
        details: { source: "cms_star_ratings_csv" },
      })
      .onConflictDoNothing();
  }
}

async function ingestBenefitChanges(url: string) {
  const rows = await parseCsv(url);
  const dataRows = rows.slice(1);
  for (const cols of dataRows) {
    const [contractId, planId, carrier, state, county, eff] = cols;
    if (!contractId || !state) continue;
    await db
      .insert(cmsPlanSignals)
      .values({
        planId: `${contractId}-${planId ?? "000"}`,
        carrier: carrier?.trim(),
        state: state.trim().slice(0, 2).toUpperCase(),
        county: county?.trim(),
        signalType: "benefit_change",
        effectiveDate: eff ? new Date(eff) : null,
        details: { source: "cms_benefit_changes_csv" },
      })
      .onConflictDoNothing();
  }
}

export async function refreshCmsPlanSignals(): Promise<{ rowsLoaded: number; usedFallback: boolean }> {
  const termUrl = process.env.CMS_TERMINATIONS_URL;
  const starUrl = process.env.CMS_STAR_RATINGS_URL;
  const benUrl = process.env.CMS_BENEFIT_CHANGES_URL;

  let loaded = 0;

  if (termUrl || starUrl || benUrl) {
    try {
      if (termUrl) { await ingestTerminations(termUrl); loaded += 1; }
      if (starUrl) { await ingestStarRatings(starUrl); loaded += 1; }
      if (benUrl)  { await ingestBenefitChanges(benUrl); loaded += 1; }
      return { rowsLoaded: loaded, usedFallback: false };
    } catch (err: any) {
      console.warn("[cms] CMS download failed, falling back to seed:", err?.message);
    }
  }

  // Fallback — seed if table is empty
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(cmsPlanSignals);
  if (Number(row?.c ?? 0) > 0) return { rowsLoaded: 0, usedFallback: true };

  for (const s of FALLBACK_SEED) {
    await db.insert(cmsPlanSignals).values(s as any).onConflictDoNothing();
  }
  return { rowsLoaded: FALLBACK_SEED.length, usedFallback: true };
}

export function startCmsSignalCron(): void {
  // Refresh once a week (Sunday at 04:00). CMS file cadence is monthly at best.
  registerCron({
    name: "cms-plan-signals",
    schedule: "0 4 * * 0",
    fn: async () => { await refreshCmsPlanSignals(); },
  });

  // Bootstrap load on startup — gated behind an advisory lock so only one
  // instance does the seed when multi-process deploys boot together.
  (async () => {
    await withAdvisoryLock("cms-bootstrap", async () => {
      await refreshCmsPlanSignals().catch(err => logError("[cms] startup load failed:", err));
    });
  })();
}
