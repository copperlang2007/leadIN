// Second-Look Re-list (M6).
//
// A lead that sits unsold in the marketplace is dead inventory: the vendor
// already sourced it, we already ran DNC/TCPA/enrichment on it, and every
// hour it ages its consumer intent decays. Rather than let it expire at full
// sticker price and never sell, we *re-list* aging unsold leads at a
// decaying discount so a price-sensitive buyer can still take it. That
// recovers revenue on inventory that would otherwise earn $0.
//
// The pricing is a pure, deterministic function of the lead's ORIGINAL price
// and its age, so it's fully unit-testable and idempotent: re-running the
// repricer on the same lead at the same age tier produces the same price and
// therefore makes no change. Price only ever moves DOWN, and never below a
// hard floor.
//
// Money-path note: the repricer writes the decayed value into `leads.price`
// and preserves the sticker value in `leads.originalPrice`. purchaseLead
// (and the vendor rev-share credit) already read `leads.price`, so a
// second-look purchase charges — and pays the vendor a share of — the
// decayed price with no change to the purchase transaction itself.

import Decimal from "decimal.js";
import { registerCron } from "./lib/cronRegistry";
import { log } from "./logger";

// ── Tunables (env-overridable so ops can adjust the curve without a deploy) ──

// A lead is "fresh" (never repriced) for this many hours after creation.
export function freshHours(): number {
  return positiveNumber(process.env.SECOND_LOOK_FRESH_HOURS, 24);
}

// The hard floor: a re-listed lead never drops below this fraction of its
// original price (default 50%). Also caps every tier's discount.
export function floorPct(): number {
  const raw = positiveNumber(process.env.SECOND_LOOK_FLOOR_PCT, 0.5);
  // Clamp to a sane (0, 1] range — a floor of 0 would let leads go free.
  return Math.min(1, Math.max(0.01, raw));
}

// Optional absolute price floor in dollars (0 = disabled). A re-listed lead
// never drops below this even if the percentage floor would allow it.
export function minPriceDollars(): number {
  return positiveNumber(process.env.SECOND_LOOK_MIN_PRICE, 0);
}

// Safety cap on how many leads a single sweep will reprice, so one cron tick
// can't do unbounded work on a large backlog.
export function maxPerRun(): number {
  return Math.trunc(positiveNumber(process.env.SECOND_LOOK_MAX_PER_RUN, 500));
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ── The decay ladder ──
//
// The tier boundaries are multiples of freshHours() and each tier's discount
// is capped at the floor, so the whole curve is driven by just two knobs
// (fresh window + floor). Tiers, by age:
//   tier 0  age < 1x fresh     → 0%      (still fresh, not re-listed)
//   tier 1  1x ≤ age < 2x      → 15%
//   tier 2  2x ≤ age < 3x      → 30%
//   tier 3  age ≥ 3x fresh     → floor   (max discount)
const TIER_DISCOUNTS = [0, 0.15, 0.3] as const;

export interface SecondLookQuote {
  price: string; // decayed price, 2-dp string (canonical for the numeric column)
  tier: number; // 0 = fresh/no discount, 1..3 = decay tier
  discountPct: number; // effective discount applied (0..floor)
}

/**
 * Pure pricing: given an original (sticker) price and an age in hours, return
 * the second-look price, tier, and effective discount. Monotonically
 * non-increasing in age; never below the floor. Exported for unit tests.
 */
export function secondLookQuote(originalPrice: string, ageHours: number): SecondLookQuote {
  const original = new Decimal(originalPrice);
  const fresh = freshHours();
  const floor = floorPct();

  // Which tier does this age fall into?
  let tier: number;
  if (ageHours < fresh) tier = 0;
  else if (ageHours < 2 * fresh) tier = 1;
  else if (ageHours < 3 * fresh) tier = 2;
  else tier = 3;

  if (tier === 0) {
    return { price: original.toFixed(2), tier: 0, discountPct: 0 };
  }

  // Tier 3 uses the full floor discount; earlier tiers use their ladder value
  // but are never allowed to exceed the floor.
  const rawDiscount = tier === 3 ? 1 - floor : TIER_DISCOUNTS[tier];
  const discount = Math.min(rawDiscount, 1 - floor);

  let price = original.mul(new Decimal(1).minus(discount));

  // Percentage floor: never below floorPct of the original.
  const pctFloorPrice = original.mul(floor);
  if (price.lessThan(pctFloorPrice)) price = pctFloorPrice;

  // Absolute floor: never below the configured minimum (but also never above
  // the original — a min price higher than sticker must not raise the price).
  const absMin = new Decimal(minPriceDollars());
  if (absMin.greaterThan(0) && price.lessThan(absMin)) {
    price = Decimal.min(absMin, original);
  }

  const rounded = price.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const effectiveDiscount = original.isZero()
    ? 0
    : original.minus(rounded).div(original).toNumber();

  return { price: rounded.toFixed(2), tier, discountPct: effectiveDiscount };
}

// The minimal shape of a lead the repricer needs — keeps computeReprice pure
// and testable without constructing a full DB row.
export interface RepriceableLead {
  price: string;
  originalPrice: string | null;
  createdAt: Date | null;
  sold: boolean;
  removed: boolean;
  pricingMode: string;
}

export interface RepricePlan {
  shouldReprice: boolean;
  basisPrice: string; // the original/sticker price to persist
  newPrice: string;
  tier: number;
  discountPct: number;
}

/**
 * Decide whether (and how) a single lead should be re-listed right now.
 *
 * `basisPrice` is the sticker price the discount is computed from: once a lead
 * has been repriced, `originalPrice` holds the sticker value and we keep
 * decaying from THAT, never from the already-discounted `price` (which would
 * let the price ratchet down every run). shouldReprice is true only when the
 * target is strictly cheaper than the current price, which makes the sweep
 * idempotent within a tier.
 */
export function computeReprice(lead: RepriceableLead, now: Date): RepricePlan {
  const noop: RepricePlan = {
    shouldReprice: false,
    basisPrice: lead.originalPrice ?? lead.price,
    newPrice: lead.price,
    tier: 0,
    discountPct: 0,
  };

  // Only per-lead priced, live, unsold inventory is eligible.
  if (lead.sold || lead.removed || lead.pricingMode !== "per_lead") return noop;
  if (!lead.createdAt) return noop;

  const ageHours = (now.getTime() - lead.createdAt.getTime()) / 3_600_000;
  const basis = lead.originalPrice ?? lead.price;
  const quote = secondLookQuote(basis, ageHours);

  const shouldReprice = new Decimal(quote.price).lessThan(new Decimal(lead.price));
  if (!shouldReprice) return { ...noop, basisPrice: basis };

  return {
    shouldReprice: true,
    basisPrice: basis,
    newPrice: quote.price,
    tier: quote.tier,
    discountPct: quote.discountPct,
  };
}

/**
 * Schedule the hourly re-list sweep. Gated by FEATURE_SECOND_LOOK_RELIST so an
 * operator can disable re-listing in a given environment.
 */
export function startSecondLookCron(): void {
  if (process.env.FEATURE_SECOND_LOOK_RELIST === "false") {
    log.info("[second-look] disabled via FEATURE_SECOND_LOOK_RELIST=false");
    return;
  }
  registerCron({
    name: "second-look-reprice",
    // Hourly at :15 — offset from the on-the-hour jobs so log lines and DB
    // load don't pile onto the same minute.
    schedule: "15 * * * *",
    fn: async () => {
      // Dynamic import breaks the storage <-> secondLook cycle (storage
      // statically imports the pure helpers from this module).
      const { storage } = await import("./storage.js");
      const result = await storage.repriceAgingLeads();
      if (result.repriced > 0) {
        log.info("[second-look] reprice sweep complete", { ...result });
      }
    },
  });
}
