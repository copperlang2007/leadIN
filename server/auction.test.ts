// Tests for the K1 live-auction resolver and orchestration.
//
// All resolver tests are pure (no DB / no WS). The orchestration tests
// inject a fake `AuctionDeps` so we can assert the exact order of
// operations (placeholder, broadcast, schedule, mark, write) without
// touching Postgres or `ws`.

import { describe, it, expect, vi } from "vitest";
import {
  resolveAuctionWinner,
  openAuction,
  resolveAuction,
  shouldOpenAuction,
  DEFAULT_AUCTION_WINDOW_MS,
  type PendingClaim,
  type AuctionDeps,
  type AuctionOpenedPayload,
  type AuctionResolvedPayload,
} from "./auction";
import type { AgentCandidate, RoutableLead } from "./routing";

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

function claim(id: number, agentUserId: string, secondsAgo = 0): PendingClaim {
  return { id, agentUserId, createdAt: new Date(Date.now() - secondsAgo * 1000) };
}

describe("resolveAuctionWinner", () => {
  it("returns no winner when there are no claims", () => {
    const out = resolveAuctionWinner(lead, [], [agent({ userId: "a" })]);
    expect(out.winnerClaimId).toBeNull();
    expect(out.winnerUserId).toBeNull();
    expect(out.loserClaimIds).toEqual([]);
  });

  it("picks the highest-ranked claimant", () => {
    const claims = [claim(1, "weak"), claim(2, "strong")];
    const candidates = [
      agent({ userId: "weak", conversionRate: 0 }),
      // higher conversion rate → bigger conv bonus → higher score
      agent({ userId: "strong", conversionRate: 0.9 }),
    ];
    const out = resolveAuctionWinner(lead, claims, candidates);
    expect(out.winnerUserId).toBe("strong");
    expect(out.winnerClaimId).toBe(2);
    expect(out.loserClaimIds).toEqual([1]);
  });

  it("first claim wins on a multi-claim race when scores tie", () => {
    // Two identically-ranked agents both claim; the earlier createdAt
    // should win — that's the whole 'speed-to-lead' point.
    const claims = [claim(10, "fast", /* seconds ago */ 3), claim(11, "slow", 1)];
    const candidates = [agent({ userId: "fast" }), agent({ userId: "slow" })];
    const out = resolveAuctionWinner(lead, claims, candidates);
    expect(out.winnerUserId).toBe("fast");
    expect(out.winnerClaimId).toBe(10);
    expect(out.loserClaimIds).toEqual([11]);
  });

  it("ignores claimants that fail the hard filter (unverified)", () => {
    const claims = [claim(1, "bogus"), claim(2, "ok")];
    const candidates = [
      agent({ userId: "bogus", verified: false }),
      agent({ userId: "ok" }),
    ];
    const out = resolveAuctionWinner(lead, claims, candidates);
    expect(out.winnerUserId).toBe("ok");
  });

  it("returns null winner when every claimant fails hard filters", () => {
    const claims = [claim(1, "a"), claim(2, "b")];
    const candidates = [
      agent({ userId: "a", verified: false }),
      agent({ userId: "b", acceptingLeads: false }),
    ];
    const out = resolveAuctionWinner(lead, claims, candidates);
    expect(out.winnerClaimId).toBeNull();
    expect(out.loserClaimIds).toEqual([1, 2]);
  });

  it("ignores claims from agents who weren't in the candidate pool", () => {
    // An agent who never appeared in the eligible-candidate hydrate
    // (e.g. wrong org) can't sneak in via a stray POST.
    const claims = [claim(1, "ghost"), claim(2, "real")];
    const candidates = [agent({ userId: "real" })];
    const out = resolveAuctionWinner(lead, claims, candidates);
    expect(out.winnerUserId).toBe("real");
  });
});

describe("shouldOpenAuction", () => {
  it("returns false when the flag is off", () => {
    expect(shouldOpenAuction(95, false)).toBe(false);
  });
  it("returns false below the mediscore threshold", () => {
    expect(shouldOpenAuction(79, true)).toBe(false);
  });
  it("returns true at or above threshold with flag on", () => {
    expect(shouldOpenAuction(80, true)).toBe(true);
    expect(shouldOpenAuction(99, true)).toBe(true);
  });
  it("treats null/undefined mediscore as zero", () => {
    expect(shouldOpenAuction(null, true)).toBe(false);
    expect(shouldOpenAuction(undefined, true)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────
// openAuction / resolveAuction — orchestration
// ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<AuctionDeps> = {}): AuctionDeps & {
  // expose call history for assertions
  opened: AuctionOpenedPayload[];
  resolved: AuctionResolvedPayload[];
  marks: Array<{ id: number; status: string }>;
  assignments: Array<{ leadId: number; agentUserId: string; matchScore: number }>;
  fallbacks: number[];
  scheduled: Array<() => void>;
  openSet: Set<number>;
} {
  const opened: AuctionOpenedPayload[] = [];
  const resolved: AuctionResolvedPayload[] = [];
  const marks: Array<{ id: number; status: string }> = [];
  const assignments: Array<{ leadId: number; agentUserId: string; matchScore: number }> = [];
  const fallbacks: number[] = [];
  const scheduled: Array<() => void> = [];
  const openSet = new Set<number>();

  const deps: AuctionDeps = {
    assignmentExists: async () => false,
    isOpen: (id) => openSet.has(id),
    markOpen: (id) => { openSet.add(id); },
    clearOpen: (id) => { openSet.delete(id); },
    listPendingClaims: async () => [],
    hydrateCandidates: async () => [],
    markClaim: async (id, status) => { marks.push({ id, status }); },
    writeAssignment: async (input) => { assignments.push(input); },
    fallbackRoute: async (leadId) => { fallbacks.push(leadId); },
    broadcastOpened: (p) => { opened.push(p); },
    broadcastResolved: (p) => { resolved.push(p); },
    schedule: (fn) => { scheduled.push(fn); },
    ...overrides,
  };
  return Object.assign(deps, { opened, resolved, marks, assignments, fallbacks, scheduled, openSet });
}

describe("openAuction", () => {
  it("is a no-op when an assignment already exists (idempotency)", async () => {
    const deps = makeDeps({ assignmentExists: async () => true });
    await openAuction({ leadId: 1, orgId: "org", lead, candidateUserIds: ["a"] }, deps);
    expect(deps.opened).toHaveLength(0);
    expect(deps.openSet.has(1)).toBe(false);
  });

  it("is a no-op when an auction was already opened for the lead", async () => {
    const deps = makeDeps();
    deps.markOpen(1);
    await openAuction({ leadId: 1, orgId: "org", lead, candidateUserIds: ["a"] }, deps);
    expect(deps.opened).toHaveLength(0);
  });

  it("broadcasts auction_opened with the default window and candidate ids", async () => {
    const deps = makeDeps();
    await openAuction({ leadId: 7, orgId: "org-1", lead, candidateUserIds: ["a", "b"] }, deps);
    expect(deps.opened).toHaveLength(1);
    const payload = deps.opened[0];
    expect(payload.type).toBe("auction_opened");
    expect(payload.leadId).toBe(7);
    expect(payload.orgId).toBe("org-1");
    expect(payload.candidateUserIds).toEqual(["a", "b"]);
    expect(payload.windowMs).toBe(DEFAULT_AUCTION_WINDOW_MS);
    expect(typeof payload.opensAt).toBe("string");
    expect(typeof payload.closesAt).toBe("string");
    // The scheduler was armed for the resolver.
    expect(deps.scheduled).toHaveLength(1);
  });
});

describe("resolveAuction", () => {
  const baseInput = { leadId: 7, orgId: "org-1" };

  it("falls back to normal routing when no claims arrived", async () => {
    const deps = makeDeps({ listPendingClaims: async () => [] });
    const out = await resolveAuction(baseInput.leadId, baseInput.orgId, lead, deps);
    expect(out.outcome).toBe("fallback");
    expect(deps.fallbacks).toEqual([baseInput.leadId]);
    expect(deps.marks).toEqual([]);
    expect(deps.assignments).toHaveLength(0);
    expect(deps.resolved[0]?.outcome).toBe("fallback");
  });

  it("picks the highest-ranked claimant, marks losers, writes assignment", async () => {
    const claims: PendingClaim[] = [
      { id: 200, agentUserId: "weak", createdAt: new Date() },
      { id: 201, agentUserId: "strong", createdAt: new Date() },
    ];
    const deps = makeDeps({
      listPendingClaims: async () => claims,
      hydrateCandidates: async () => [
        agent({ userId: "weak", conversionRate: 0 }),
        agent({ userId: "strong", conversionRate: 0.9 }),
      ],
    });
    const out = await resolveAuction(baseInput.leadId, baseInput.orgId, lead, deps);
    expect(out.outcome).toBe("won");
    expect(out.winnerUserId).toBe("strong");
    expect(deps.assignments).toEqual([
      expect.objectContaining({ leadId: 7, orgId: "org-1", agentUserId: "strong" }),
    ]);
    const byId = Object.fromEntries(deps.marks.map(m => [m.id, m.status]));
    expect(byId[201]).toBe("won");
    expect(byId[200]).toBe("lost");
  });

  it("is idempotent — returns early if an assignment already exists", async () => {
    const deps = makeDeps({ assignmentExists: async () => true });
    const listSpy = vi.spyOn(deps, "listPendingClaims");
    const out = await resolveAuction(baseInput.leadId, baseInput.orgId, lead, deps);
    expect(out.outcome).toBe("won");
    expect(listSpy).not.toHaveBeenCalled();
    expect(deps.assignments).toHaveLength(0);
  });

  it("falls back when claimants exist but none pass hard filters", async () => {
    const deps = makeDeps({
      listPendingClaims: async () => [{ id: 200, agentUserId: "shady", createdAt: new Date() }],
      hydrateCandidates: async () => [agent({ userId: "shady", verified: false })],
    });
    const out = await resolveAuction(baseInput.leadId, baseInput.orgId, lead, deps);
    expect(out.outcome).toBe("fallback");
    expect(deps.assignments).toHaveLength(0);
    expect(deps.marks).toEqual([{ id: 200, status: "expired" }]);
    expect(deps.fallbacks).toEqual([baseInput.leadId]);
  });

  it("a verified claimant beats an unverified one in a multi-claim race", async () => {
    const claims: PendingClaim[] = [
      { id: 201, agentUserId: "shady", createdAt: new Date(Date.now() - 5000) }, // earlier
      { id: 202, agentUserId: "ok", createdAt: new Date() }, // later
    ];
    const deps = makeDeps({
      listPendingClaims: async () => claims,
      hydrateCandidates: async () => [
        agent({ userId: "shady", verified: false }),
        agent({ userId: "ok" }),
      ],
    });
    const out = await resolveAuction(baseInput.leadId, baseInput.orgId, lead, deps);
    expect(out.winnerUserId).toBe("ok");
    expect(deps.assignments[0]?.agentUserId).toBe("ok");
  });
});
