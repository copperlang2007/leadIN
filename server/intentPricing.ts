// Intent-based dynamic pricing — "smart billing so buyers get a fair shake".
//
// Commodity lead sellers charge a flat CPL regardless of how good or how ready
// a lead is. This engine prices every lead from four transparent, auditable
// factors so buyers pay more for genuinely better leads and less for weaker
// ones — and so the marketplace can surge with real-time demand the way
// Phonexa/Boberdoo/Ringba do, but with the pricing math fully disclosed.
//
//   price = base × quality(MediScore) × intent × exclusivity × demand
//
// Each factor is a bounded, monotonic mapping (documented below) and the full
// decomposition is returned so the buyer UI can show exactly why a lead costs
// what it costs. All money math runs through Decimal (no float drift).

import Decimal from "decimal.js";

export interface PricingFactors {
  /** Base CPL for this lead type/vertical (USD). */
  basePrice: number | string;
  /** MediScore 0..100 (lead quality). */
  mediscore: number;
  /** Detected purchase-intent 0..100 (from behavior/call signals). */
  intentScore: number;
  /** "Exclusive" sells to one buyer; anything else is treated as shared. */
  exclusivity: string;
  /**
   * Real-time demand index: ratio of active buyer demand to available supply.
   * 1.0 = balanced, >1 = surge, <1 = soft market. Clamped to [0.5, 2.0].
   */
  demandIndex?: number;
  /** Optional hard price floor (USD). */
  floor?: number | string;
  /** Optional hard price ceiling (USD). */
  ceiling?: number | string;
}

export interface PriceBreakdown {
  price: string; // final, clamped, 2-decimal USD
  base: string;
  qualityFactor: number;
  intentFactor: number;
  exclusivityFactor: number;
  demandFactor: number;
  rawPrice: string; // before floor/ceiling clamp
  clamped: boolean;
  computedAt: string;
}

function clampNum(x: number, lo: number, hi: number): number {
  if (!isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

// --- Factor mappings (all bounded & monotonic) -----------------------------

/** MediScore 0..100 -> 0.50x .. 1.50x. A 50-score lead prices at base. */
export function qualityFactor(mediscore: number): number {
  return Number((0.5 + clampNum(mediscore, 0, 100) / 100).toFixed(4));
}

/** Intent 0..100 -> 0.60x .. 1.60x. High intent (e.g. live transfer) lifts price. */
export function intentFactor(intentScore: number): number {
  return Number((0.6 + clampNum(intentScore, 0, 100) / 100).toFixed(4));
}

/** Exclusive leads command a premium over shared. */
export function exclusivityFactor(exclusivity: string): number {
  return /exclusive/i.test(exclusivity ?? "") ? 1.5 : 1.0;
}

/** Demand index -> surge multiplier, clamped to [0.5, 2.0]. */
export function demandFactor(demandIndex: number | undefined): number {
  return Number(clampNum(demandIndex ?? 1, 0.5, 2.0).toFixed(4));
}

/**
 * Compute the dynamic price + full factor decomposition. Pure & deterministic.
 */
export function priceLead(f: PricingFactors): PriceBreakdown {
  const base = new Decimal(f.basePrice || 0);
  const q = qualityFactor(f.mediscore);
  const intent = intentFactor(f.intentScore);
  const excl = exclusivityFactor(f.exclusivity);
  const demand = demandFactor(f.demandIndex);

  const raw = base.times(q).times(intent).times(excl).times(demand);

  let priced = raw;
  let clamped = false;
  if (f.floor !== undefined && f.floor !== null) {
    const floor = new Decimal(f.floor);
    if (priced.lessThan(floor)) {
      priced = floor;
      clamped = true;
    }
  }
  if (f.ceiling !== undefined && f.ceiling !== null) {
    const ceiling = new Decimal(f.ceiling);
    if (priced.greaterThan(ceiling)) {
      priced = ceiling;
      clamped = true;
    }
  }

  return {
    price: priced.toFixed(2),
    base: base.toFixed(2),
    qualityFactor: q,
    intentFactor: intent,
    exclusivityFactor: excl,
    demandFactor: demand,
    rawPrice: raw.toFixed(2),
    clamped,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Derive a demand index from live marketplace counts. Returns 1.0 when there
 * is no supply signal (avoids divide-by-zero surge spikes on an empty market).
 */
export function computeDemandIndex(activeBuyers: number, availableLeads: number): number {
  if (availableLeads <= 0) return 1.0;
  return clampNum(activeBuyers / availableLeads, 0.5, 2.0);
}
