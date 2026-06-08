// Pure unit tests for the smart-match picker. These exercise the matcher,
// the remaining-quota math, and the subscription picker without touching
// Postgres — the DB delivery path is covered by integration tests that
// boot a Postgres test DB.

import { describe, it, expect } from "vitest";
import {
  matchesFilter,
  pickBestSubscription,
  remainingQuota,
  priceToCents,
  SMART_MATCH_TIERS,
  CYCLE_LENGTH_DAYS,
  type MatchableLead,
  type MatchableSubscription,
  type SmartMatchFilter,
} from "./smartMatch";

function lead(overrides: Partial<MatchableLead> = {}): MatchableLead {
  return {
    id: 1,
    type: "medicare",
    state: "FL",
    mediscore: 70,
    priceCents: 2500,
    sold: false,
    removed: false,
    dncFlagged: false,
    ...overrides,
  };
}

function sub(overrides: Partial<MatchableSubscription> = {}): MatchableSubscription {
  return {
    id: 100,
    agentUserId: "agent-a",
    status: "active",
    monthlyLeadQuota: 25,
    leadsDeliveredThisCycle: 0,
    filterCriteria: {},
    ...overrides,
  };
}

describe("priceToCents", () => {
  it("converts decimal strings to integer cents", () => {
    expect(priceToCents("29.50")).toBe(2950);
    expect(priceToCents("0")).toBe(0);
    expect(priceToCents("100")).toBe(10000);
  });

  it("rounds rather than truncates (defensive against floating point)", () => {
    // 29.999 → 2999.9 → rounds to 3000, not 2999. This matters because Postgres
    // numeric(10,2) only ever sends us two decimals, but if a caller hands in
    // a JS number we want consistent rounding behaviour.
    expect(priceToCents(29.999)).toBe(3000);
  });

  it("treats null/undefined/NaN as 0 so missing prices don't ghost-pass caps", () => {
    expect(priceToCents(null)).toBe(0);
    expect(priceToCents(undefined)).toBe(0);
    expect(priceToCents("not-a-number")).toBe(0);
  });
});

describe("SMART_MATCH_TIERS", () => {
  it("encodes the three documented tiers in cents", () => {
    // 25 → $99, 50 → $179, 100 → $329. Lock the numbers in so a refactor
    // can't silently change pricing.
    expect(SMART_MATCH_TIERS).toEqual([
      { quota: 25, priceCents: 9900 },
      { quota: 50, priceCents: 17900 },
      { quota: 100, priceCents: 32900 },
    ]);
  });

  it("CYCLE_LENGTH_DAYS is the 30-day monthly cycle", () => {
    expect(CYCLE_LENGTH_DAYS).toBe(30);
  });
});

describe("matchesFilter", () => {
  it("matches an empty filter against any non-blocked lead", () => {
    expect(matchesFilter(lead(), {})).toBe(true);
  });

  it("rejects sold leads even when filter matches", () => {
    expect(matchesFilter(lead({ sold: true }), {})).toBe(false);
  });

  it("rejects removed leads even when filter matches", () => {
    expect(matchesFilter(lead({ removed: true }), {})).toBe(false);
  });

  it("rejects DNC-flagged leads (regulatory hard-stop)", () => {
    // DNC is non-negotiable: a subscription cannot opt-in to DNC leads.
    expect(matchesFilter(lead({ dncFlagged: true }), {})).toBe(false);
  });

  it("filters by lead type", () => {
    const filter: SmartMatchFilter = { types: ["aca", "auto"] };
    expect(matchesFilter(lead({ type: "medicare" }), filter)).toBe(false);
    expect(matchesFilter(lead({ type: "aca" }), filter)).toBe(true);
  });

  it("filters by state, case-insensitive", () => {
    const filter: SmartMatchFilter = { states: ["fl", "TX"] };
    expect(matchesFilter(lead({ state: "FL" }), filter)).toBe(true);
    expect(matchesFilter(lead({ state: "tx" }), filter)).toBe(true);
    expect(matchesFilter(lead({ state: "CA" }), filter)).toBe(false);
  });

  it("enforces minMediscore as a >= threshold", () => {
    const filter: SmartMatchFilter = { minMediscore: 70 };
    expect(matchesFilter(lead({ mediscore: 69 }), filter)).toBe(false);
    expect(matchesFilter(lead({ mediscore: 70 }), filter)).toBe(true);
    expect(matchesFilter(lead({ mediscore: 95 }), filter)).toBe(true);
  });

  it("enforces maxPriceCents as a <= cap", () => {
    const filter: SmartMatchFilter = { maxPriceCents: 3000 };
    expect(matchesFilter(lead({ priceCents: 2500 }), filter)).toBe(true);
    expect(matchesFilter(lead({ priceCents: 3000 }), filter)).toBe(true);
    expect(matchesFilter(lead({ priceCents: 3001 }), filter)).toBe(false);
  });

  it("requires ALL present criteria to be satisfied (AND semantics)", () => {
    const filter: SmartMatchFilter = {
      types: ["medicare"],
      states: ["FL"],
      minMediscore: 60,
      maxPriceCents: 5000,
    };
    expect(matchesFilter(lead(), filter)).toBe(true);
    // One miss is enough to fail the whole filter.
    expect(matchesFilter(lead({ state: "TX" }), filter)).toBe(false);
    expect(matchesFilter(lead({ type: "auto" }), filter)).toBe(false);
    expect(matchesFilter(lead({ mediscore: 50 }), filter)).toBe(false);
    expect(matchesFilter(lead({ priceCents: 10000 }), filter)).toBe(false);
  });

  it("empty arrays in the filter are treated as wildcards", () => {
    // states: [] means "no state restriction", not "no states ever match".
    expect(matchesFilter(lead({ state: "FL" }), { states: [] })).toBe(true);
    expect(matchesFilter(lead({ type: "aca" }), { types: [] })).toBe(true);
  });
});

describe("remainingQuota", () => {
  it("returns the simple subtraction when delivered < quota", () => {
    expect(remainingQuota({ monthlyLeadQuota: 25, leadsDeliveredThisCycle: 0 })).toBe(25);
    expect(remainingQuota({ monthlyLeadQuota: 25, leadsDeliveredThisCycle: 10 })).toBe(15);
  });

  it("returns 0 when delivered == quota (cycle exhausted)", () => {
    expect(remainingQuota({ monthlyLeadQuota: 25, leadsDeliveredThisCycle: 25 })).toBe(0);
  });

  it("clamps to 0 if delivered somehow exceeds quota", () => {
    // Defensive: a buggy ingest path or admin override could push delivered
    // past quota. The picker treats 'remaining <= 0' as 'skip', so we want
    // negative values to coerce cleanly to 0 rather than confuse the math.
    expect(remainingQuota({ monthlyLeadQuota: 25, leadsDeliveredThisCycle: 30 })).toBe(0);
  });
});

describe("pickBestSubscription", () => {
  it("returns null when nothing matches", () => {
    const subs = [sub({ filterCriteria: { states: ["TX"] } })];
    expect(pickBestSubscription(lead({ state: "FL" }), subs)).toBeNull();
  });

  it("returns null when matches exist but all are out of quota", () => {
    const subs = [
      sub({ id: 1, monthlyLeadQuota: 25, leadsDeliveredThisCycle: 25 }),
      sub({ id: 2, monthlyLeadQuota: 50, leadsDeliveredThisCycle: 50 }),
    ];
    expect(pickBestSubscription(lead(), subs)).toBeNull();
  });

  it("skips non-active subscriptions", () => {
    const subs = [
      sub({ id: 1, status: "cancelled", monthlyLeadQuota: 100 }),
      sub({ id: 2, status: "active", monthlyLeadQuota: 25 }),
    ];
    const winner = pickBestSubscription(lead(), subs);
    expect(winner?.id).toBe(2);
  });

  it("picks the subscription with the most remaining quota", () => {
    // sub-1 has 5 left, sub-2 has 90 left, sub-3 has 50 left.
    // The 100/mo plan (sub-2) wins so the 25/mo plan doesn't starve it.
    const subs = [
      sub({ id: 1, agentUserId: "a", monthlyLeadQuota: 25, leadsDeliveredThisCycle: 20 }),
      sub({ id: 2, agentUserId: "b", monthlyLeadQuota: 100, leadsDeliveredThisCycle: 10 }),
      sub({ id: 3, agentUserId: "c", monthlyLeadQuota: 50, leadsDeliveredThisCycle: 0 }),
    ];
    const winner = pickBestSubscription(lead(), subs);
    expect(winner?.id).toBe(2);
    expect(winner?.agentUserId).toBe("b");
  });

  it("uses id ascending as a deterministic tie-breaker on equal remaining quota", () => {
    // Both have 25 remaining; the lower id wins so concurrent ingests
    // produce identical assignments.
    const subs = [
      sub({ id: 7, agentUserId: "later", monthlyLeadQuota: 25, leadsDeliveredThisCycle: 0 }),
      sub({ id: 3, agentUserId: "earlier", monthlyLeadQuota: 25, leadsDeliveredThisCycle: 0 }),
    ];
    const winner = pickBestSubscription(lead(), subs);
    expect(winner?.id).toBe(3);
    expect(winner?.agentUserId).toBe("earlier");
  });

  it("filters subscriptions whose criteria the lead fails", () => {
    // Only sub-2's criteria matches the FL medicare lead.
    const subs = [
      sub({ id: 1, agentUserId: "tx-agent", filterCriteria: { states: ["TX"] } }),
      sub({ id: 2, agentUserId: "fl-agent", filterCriteria: { states: ["FL"] } }),
    ];
    const winner = pickBestSubscription(lead(), subs);
    expect(winner?.agentUserId).toBe("fl-agent");
  });

  it("never picks a sold lead even with matching criteria + open quota", () => {
    const subs = [sub({ id: 1, filterCriteria: { states: ["FL"] } })];
    expect(pickBestSubscription(lead({ sold: true }), subs)).toBeNull();
  });

  it("decrement semantics: a subscription at quota-1 still wins, then exhausts", () => {
    // Reproduce the decrement contract: a subscription with 1 lead left is
    // a valid pick (remaining = 1 > 0). After delivery the storage-layer
    // decrement bumps deliveredThisCycle to monthlyLeadQuota, and the next
    // pickBestSubscription call must skip it.
    const before = sub({ id: 1, monthlyLeadQuota: 25, leadsDeliveredThisCycle: 24 });
    expect(pickBestSubscription(lead(), [before])?.id).toBe(1);

    const after: MatchableSubscription = { ...before, leadsDeliveredThisCycle: 25 };
    expect(pickBestSubscription(lead(), [after])).toBeNull();
  });

  it("ignores DNC-flagged leads even when every other criterion passes", () => {
    const subs = [sub({ id: 1, filterCriteria: { states: ["FL"], minMediscore: 0 } })];
    expect(pickBestSubscription(lead({ dncFlagged: true }), subs)).toBeNull();
  });
});
