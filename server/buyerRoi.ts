// Buyer ROI analytics — the retention lever the buyer UI was missing.
//
// Buyers churn when they can't see what their spend actually returns. This
// module turns a buyer's purchase history into the numbers that matter:
// cost-per-acquired-lead (CAC), conversion rate, and ROI — sliced by VENDOR
// and by MediScore BAND so a buyer can see, concretely, "score 80+ leads from
// vendor X convert at 18% and pay back 3x; score <40 leads waste my money."
// That visibility is what makes the marketplace sticky and pushes spend toward
// the best supply.
//
// Pure aggregation (no DB) so it is fully unit-testable. Revenue is derived
// from the buyer's own configurable average commission rather than a fabricated
// figure — every number is traceable to the buyer's real inputs. All money math
// runs through Decimal.

import { addUsd, divUsd, toUsd } from "./lib/money";

export interface RoiRecord {
  cost: number | string; // what the buyer paid for the lead
  mediscore: number; // 0..100
  vendorId: number | string;
  vendorName: string;
  converted: boolean; // did this lead convert (enroll/close)?
  /** Optional explicit revenue; when absent, avgCommission is used for converts. */
  revenue?: number | string;
}

export interface RoiOptions {
  /** Buyer's average commission per conversion, used when a record has no explicit revenue. */
  avgCommission?: number | string;
}

export interface RoiMetrics {
  leads: number;
  spend: string;
  conversions: number;
  conversionRate: number; // 0..1
  cac: string; // spend / leads
  costPerConversion: string; // spend / conversions ("0.00" if none)
  revenue: string;
  /** ROI as a ratio: (revenue - spend) / spend. 0 when no spend. */
  roi: number;
  avgMediscore: number;
}

export interface RoiBand extends RoiMetrics {
  band: string; // e.g. "80-100"
}

export interface RoiVendor extends RoiMetrics {
  vendorId: string;
  vendorName: string;
}

export interface BuyerRoiReport {
  overall: RoiMetrics;
  byVendor: RoiVendor[];
  byScoreBand: RoiBand[];
  computedAt: string;
}

const BANDS: Array<{ band: string; min: number; max: number }> = [
  { band: "0-19", min: 0, max: 19 },
  { band: "20-39", min: 20, max: 39 },
  { band: "40-59", min: 40, max: 59 },
  { band: "60-79", min: 60, max: 79 },
  { band: "80-100", min: 80, max: 100 },
];

export function scoreBand(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  return BANDS.find(b => s >= b.min && s <= b.max)!.band;
}

function recordRevenue(r: RoiRecord, avgCommission: number | string): string {
  if (r.revenue !== undefined && r.revenue !== null) return toUsd(r.revenue);
  return r.converted ? toUsd(avgCommission) : "0.00";
}

function metricsFor(records: RoiRecord[], avgCommission: number | string): RoiMetrics {
  const leads = records.length;
  const spend = addUsd(...records.map(r => r.cost));
  const conversions = records.filter(r => r.converted).length;
  const revenue = addUsd(...records.map(r => recordRevenue(r, avgCommission)));
  const conversionRate = leads > 0 ? conversions / leads : 0;
  const avgMediscore =
    leads > 0 ? Math.round(records.reduce((a, r) => a + (r.mediscore || 0), 0) / leads) : 0;

  // ROI = (revenue - spend) / spend
  const spendNum = parseFloat(spend);
  const revNum = parseFloat(revenue);
  const roi = spendNum > 0 ? Number(((revNum - spendNum) / spendNum).toFixed(4)) : 0;

  return {
    leads,
    spend,
    conversions,
    conversionRate: Number(conversionRate.toFixed(4)),
    cac: leads > 0 ? divUsd(spend, leads) : "0.00",
    costPerConversion: conversions > 0 ? divUsd(spend, conversions) : "0.00",
    revenue,
    roi,
    avgMediscore,
  };
}

/**
 * Build the full buyer ROI report. Pure & deterministic given records + options.
 */
export function buildBuyerRoiReport(records: RoiRecord[], opts: RoiOptions = {}): BuyerRoiReport {
  const avgCommission = opts.avgCommission ?? 0;

  // Group by vendor
  const vendorGroups = new Map<string, RoiRecord[]>();
  for (const r of records) {
    const key = String(r.vendorId);
    if (!vendorGroups.has(key)) vendorGroups.set(key, []);
    vendorGroups.get(key)!.push(r);
  }
  const byVendor: RoiVendor[] = Array.from(vendorGroups.entries())
    .map(([vendorId, recs]) => ({
      vendorId,
      vendorName: recs[0]?.vendorName ?? `Vendor ${vendorId}`,
      ...metricsFor(recs, avgCommission),
    }))
    .sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend));

  // Group by score band (always emit all bands so the UI table is stable)
  const byScoreBand: RoiBand[] = BANDS.map(b => {
    const recs = records.filter(r => scoreBand(r.mediscore) === b.band);
    return { band: b.band, ...metricsFor(recs, avgCommission) };
  });

  return {
    overall: metricsFor(records, avgCommission),
    byVendor,
    byScoreBand,
    computedAt: new Date().toISOString(),
  };
}
