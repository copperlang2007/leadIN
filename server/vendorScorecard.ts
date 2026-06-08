// Wave 7 (T5) — Vendor performance scorecard.
//
// For a given vendor, aggregate marketplace-wide performance per lead `type`
// and per `source`:
//   - total_ingested  (leads listed by the vendor in the window)
//   - total_sold      (leads sold to any buyer)
//   - conv_rate       (sold / ingested)
//   - avg_mediscore   (signal-quality average over ingested leads)
//   - dispute_rate    (disputes filed / sold)
//   - revenue         (gross order revenue attributed to those leads)
//
// Each row also carries a `pct_change` field comparing the trailing-30d
// window against the prior-30d window for the same key.
//
// The DB-touching half lives in storage.ts (`getVendorScorecardRows`); the
// pure aggregation math is extracted into `computeScorecardFromRows` so the
// percentage / delta logic can be unit tested without a database.

import { storage } from "./storage";

export type ScorecardDimension = "type" | "source";

export interface ScorecardRawRow {
  key: string;               // type or source value
  ingested: number;
  sold: number;
  avgMediscore: number;      // 0..100, 0 when ingested === 0
  disputes: number;          // count of disputes filed against the vendor's
                              // leads in this bucket
  revenueCents: number;      // sum of order.price (in cents) for sold leads
}

export interface ScorecardRow {
  key: string;
  ingested: number;
  sold: number;
  convRate: number;          // 0..1 with 4 decimals of precision
  avgMediscore: number;      // rounded to nearest int
  disputeRate: number;       // disputes / sold, 0..1, 4 decimals
  revenueUsd: string;        // dollars w/ 2 decimals as a string
  pctChange: number | null;  // (trailing - prior) / prior of revenue.
                              // null when no prior data to compare to.
}

export interface VendorScorecard {
  vendorId: number;
  windowDays: number;
  generatedAt: string;
  byType: ScorecardRow[];
  bySource: ScorecardRow[];
  totals: {
    ingested: number;
    sold: number;
    convRate: number;
    revenueUsd: string;
    disputes: number;
    disputeRate: number;
  };
}

// ──────────────────────────────────────────────────────
// Pure helpers (no DB) — exported for testing
// ──────────────────────────────────────────────────────

/** Safe division, returning 0 when the denominator is 0/NaN/Infinity. */
function safeDiv(num: number, denom: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom === 0) return 0;
  return num / denom;
}

/** Round a number to N decimals, returning a plain number. */
function round(n: number, decimals = 4): number {
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
}

/** Cents → dollars string with 2 decimal places. Negative cents clamp at 0. */
function centsToDollars(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.max(0, cents) : 0;
  return (safe / 100).toFixed(2);
}

/**
 * Compute the trailing-window scorecard from raw aggregated rows, joining
 * trailing and prior windows by `key` so we can attach `pct_change`.
 *
 * Pure function — no DB, no env, no clock dependencies. The caller passes
 * trailing + prior rows already aggregated by the SQL layer.
 */
export function computeScorecardFromRows(
  trailing: ScorecardRawRow[],
  prior: ScorecardRawRow[],
): ScorecardRow[] {
  const priorByKey = new Map<string, ScorecardRawRow>();
  for (const row of prior) priorByKey.set(row.key, row);

  return trailing
    .map(row => {
      const priorRow = priorByKey.get(row.key);
      const trailingRevenue = row.revenueCents;
      const priorRevenue = priorRow?.revenueCents ?? 0;

      // pct_change is null when there's no prior signal at all (so the UI
      // can render a "—" rather than "+Infinity%" / "+100%"). A vendor that
      // earned $0 → $X looks like brand-new business, not a comparable delta.
      let pctChange: number | null;
      if (!priorRow || priorRevenue === 0) {
        pctChange = null;
      } else {
        pctChange = round((trailingRevenue - priorRevenue) / priorRevenue, 4);
      }

      return {
        key: row.key,
        ingested: row.ingested,
        sold: row.sold,
        convRate: round(safeDiv(row.sold, row.ingested), 4),
        avgMediscore: Math.round(row.avgMediscore),
        disputeRate: round(safeDiv(row.disputes, row.sold), 4),
        revenueUsd: centsToDollars(row.revenueCents),
        pctChange,
      };
    })
    .sort((a, b) => Number(b.revenueUsd) - Number(a.revenueUsd) || b.sold - a.sold);
}

/** Roll a set of raw rows up into platform-level totals for the vendor. */
export function totalsFromRows(rows: ScorecardRawRow[]): VendorScorecard["totals"] {
  let ingested = 0;
  let sold = 0;
  let disputes = 0;
  let revenueCents = 0;
  for (const r of rows) {
    ingested += r.ingested;
    sold += r.sold;
    disputes += r.disputes;
    revenueCents += r.revenueCents;
  }
  return {
    ingested,
    sold,
    convRate: round(safeDiv(sold, ingested), 4),
    revenueUsd: centsToDollars(revenueCents),
    disputes,
    disputeRate: round(safeDiv(disputes, sold), 4),
  };
}

// ──────────────────────────────────────────────────────
// Orchestrator — DB-touching
// ──────────────────────────────────────────────────────

/**
 * Build the vendor scorecard for a given vendor, comparing the trailing
 * 30 days against the prior 30 days.
 */
export async function getVendorScorecard(vendorId: number): Promise<VendorScorecard> {
  const now = new Date();
  const trailingStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const priorStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Pull all four aggregations in parallel.
  const [byTypeTrailing, byTypePrior, bySourceTrailing, bySourcePrior] = await Promise.all([
    storage.getVendorScorecardRows(vendorId, "type", trailingStart, now),
    storage.getVendorScorecardRows(vendorId, "type", priorStart, trailingStart),
    storage.getVendorScorecardRows(vendorId, "source", trailingStart, now),
    storage.getVendorScorecardRows(vendorId, "source", priorStart, trailingStart),
  ]);

  return {
    vendorId,
    windowDays: 30,
    generatedAt: now.toISOString(),
    byType: computeScorecardFromRows(byTypeTrailing, byTypePrior),
    bySource: computeScorecardFromRows(bySourceTrailing, bySourcePrior),
    totals: totalsFromRows(byTypeTrailing),
  };
}
