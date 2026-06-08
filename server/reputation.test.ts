// Unit tests for the pure helpers in ./reputation.ts (weight aggregation,
// 90-day rolling window, clamping). The DB-touching layers (recordEvent,
// computeReputationScore, getTopAgentsForOrg) defer to drizzle and are
// covered by integration tests that boot a Postgres test DB; here we keep it
// fast and pure.

import { describe, it, expect } from "vitest";
import {
  REPUTATION_WEIGHTS,
  REPUTATION_SCORE_MIN,
  REPUTATION_SCORE_MAX,
  REPUTATION_WINDOW_DAYS,
  TOP_AGENT_MIN_EVENTS,
  aggregateEvents,
  clampReputationScore,
} from "./reputation";
import { rankCandidates, type RoutableLead, type AgentCandidate } from "./routing";

describe("REPUTATION_WEIGHTS", () => {
  it("encodes the documented lifecycle weights", () => {
    expect(REPUTATION_WEIGHTS.accepted_assignment).toBe(2);
    expect(REPUTATION_WEIGHTS.declined_assignment).toBe(-1);
    expect(REPUTATION_WEIGHTS.purchase).toBe(5);
    expect(REPUTATION_WEIGHTS.dispute_filed_against).toBe(-3);
    expect(REPUTATION_WEIGHTS.dispute_approved).toBe(-5);
  });

  it("includes the K4-owned crm_deal_closed event so we can rank scores correctly", () => {
    // We don't write these — K4 does — but the score must include them.
    expect(REPUTATION_WEIGHTS.crm_deal_closed).toBeGreaterThan(0);
  });
});

describe("clampReputationScore", () => {
  it("returns the value unchanged when within bounds", () => {
    expect(clampReputationScore(0)).toBe(0);
    expect(clampReputationScore(25)).toBe(25);
    expect(clampReputationScore(-25)).toBe(-25);
  });

  it("clamps to the maximum of 100", () => {
    expect(clampReputationScore(150)).toBe(REPUTATION_SCORE_MAX);
    expect(clampReputationScore(REPUTATION_SCORE_MAX)).toBe(REPUTATION_SCORE_MAX);
    expect(clampReputationScore(101)).toBe(100);
  });

  it("clamps to the minimum of -50", () => {
    expect(clampReputationScore(-999)).toBe(REPUTATION_SCORE_MIN);
    expect(clampReputationScore(REPUTATION_SCORE_MIN)).toBe(REPUTATION_SCORE_MIN);
    expect(clampReputationScore(-51)).toBe(-50);
  });

  it("treats non-finite input as 0 (defensive against bad SQL coalesces)", () => {
    expect(clampReputationScore(Number.NaN)).toBe(0);
    expect(clampReputationScore(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampReputationScore(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("aggregateEvents", () => {
  const now = new Date("2026-06-08T12:00:00Z");
  const dayMs = 24 * 60 * 60 * 1000;

  it("sums weights within the trailing window", () => {
    const events = [
      { weight: 5, createdAt: new Date(now.getTime() - 1 * dayMs) },
      { weight: 2, createdAt: new Date(now.getTime() - 30 * dayMs) },
      { weight: -1, createdAt: new Date(now.getTime() - 60 * dayMs) },
    ];
    expect(aggregateEvents(events, now)).toBe(6);
  });

  it("excludes events older than the 90-day window", () => {
    const events = [
      { weight: 5, createdAt: new Date(now.getTime() - 91 * dayMs) }, // stale
      { weight: 5, createdAt: new Date(now.getTime() - 89 * dayMs) }, // fresh
    ];
    expect(aggregateEvents(events, now)).toBe(5);
  });

  it("treats edge-of-window events as fresh", () => {
    // Events exactly at the cutoff should be counted (cutoff is < not <=).
    const events = [
      { weight: 3, createdAt: new Date(now.getTime() - REPUTATION_WINDOW_DAYS * dayMs + 1000) },
    ];
    expect(aggregateEvents(events, now)).toBe(3);
  });

  it("returns 0 for an empty event stream", () => {
    expect(aggregateEvents([], now)).toBe(0);
  });

  it("clamps positive aggregates above 100", () => {
    // 30 purchases at +5 each = 150 → clamped to 100.
    const events = Array.from({ length: 30 }, () => ({
      weight: 5,
      createdAt: new Date(now.getTime() - 1 * dayMs),
    }));
    expect(aggregateEvents(events, now)).toBe(100);
  });

  it("clamps negative aggregates below -50", () => {
    // 20 approved disputes at -5 = -100 → clamped to -50.
    const events = Array.from({ length: 20 }, () => ({
      weight: -5,
      createdAt: new Date(now.getTime() - 1 * dayMs),
    }));
    expect(aggregateEvents(events, now)).toBe(-50);
  });

  it("skips events with null createdAt", () => {
    const events = [
      { weight: 99, createdAt: null },
      { weight: 7, createdAt: new Date(now.getTime() - 1 * dayMs) },
    ];
    expect(aggregateEvents(events, now)).toBe(7);
  });

  it("handles a mix of fresh, stale, and edge events", () => {
    const events = [
      { weight: 10, createdAt: new Date(now.getTime() - 1 * dayMs) }, // fresh
      { weight: -3, createdAt: new Date(now.getTime() - 100 * dayMs) }, // stale
      { weight: -1, createdAt: new Date(now.getTime() - 89 * dayMs) }, // fresh
      { weight: 5, createdAt: new Date(now.getTime() - 91 * dayMs) }, // stale
    ];
    expect(aggregateEvents(events, now)).toBe(9);
  });
});

describe("top-agent threshold constant", () => {
  it("exposes a sensible minimum-events threshold", () => {
    // Hardcoded in the spec as "at least 3 events". Lock it in so a refactor
    // can't silently lower it.
    expect(TOP_AGENT_MIN_EVENTS).toBe(3);
  });
});

// ──────────────────────────────────────────────────────
// Integration with the routing engine: rankCandidates must factor reputation.
// ──────────────────────────────────────────────────────

describe("rankCandidates × reputation", () => {
  const lead: RoutableLead = {
    state: "FL",
    zipCode: "33101",
    source: "Humana",
    compatibilityScore: 70,
  };

  function agent(overrides: Partial<AgentCandidate> = {}): AgentCandidate {
    return {
      userId: "u1",
      licensedStates: ["FL"],
      appointedCarriers: [],
      territoryZips: [],
      territoryCounties: [],
      capacityLimit: 25,
      openLeadCount: 0,
      conversionRate: 0,
      acceptingLeads: true,
      verified: true,
      ...overrides,
    };
  }

  it("adds reputation×0.5 to the routing score", () => {
    // Baseline (reputation 0) vs reputation 40: delta should be +20.
    const baseline = rankCandidates(lead, [agent({ userId: "base" })])!;
    const repped = rankCandidates(lead, [agent({ userId: "repped", reputationScore: 40 })])!;
    expect(repped.score - baseline.score).toBe(20);
    expect(repped.reasons).toContain("reputation:40");
  });

  it("a negative reputation pushes the score down", () => {
    const baseline = rankCandidates(lead, [agent({ userId: "base" })])!;
    const bad = rankCandidates(lead, [agent({ userId: "bad", reputationScore: -10 })])!;
    expect(bad.score - baseline.score).toBe(-5);
  });

  it("missing reputationScore defaults to 0 (no bonus, no reason)", () => {
    const noRep = rankCandidates(lead, [agent({ userId: "norep" })])!;
    expect(noRep.reasons.some(r => r.startsWith("reputation:"))).toBe(false);
  });
});
