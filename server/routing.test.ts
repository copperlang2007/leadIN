import { describe, it, expect } from "vitest";
import { rankCandidates, type RoutableLead, type AgentCandidate } from "./routing";

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

describe("rankCandidates", () => {
  it("returns null with no candidates", () => {
    expect(rankCandidates(lead, [])).toBeNull();
  });

  it("rejects unverified agents", () => {
    expect(rankCandidates(lead, [agent({ verified: false })])).toBeNull();
  });

  it("rejects agents not accepting leads", () => {
    expect(rankCandidates(lead, [agent({ acceptingLeads: false })])).toBeNull();
  });

  it("rejects agents missing the lead's state", () => {
    expect(rankCandidates(lead, [agent({ licensedStates: ["TX"] })])).toBeNull();
  });

  it("rejects agents whose territory excludes the ZIP", () => {
    expect(rankCandidates(lead, [agent({ territoryZips: ["33102"] })])).toBeNull();
  });

  it("rejects agents at capacity", () => {
    expect(rankCandidates(lead, [agent({ capacityLimit: 5, openLeadCount: 5 })])).toBeNull();
  });

  it("ranks agent in-territory above a generic match", () => {
    const generic = agent({ userId: "generic" });
    const inTerritory = agent({ userId: "in-territory", territoryZips: ["33101"] });
    const best = rankCandidates(lead, [generic, inTerritory]);
    expect(best?.userId).toBe("in-territory");
  });

  it("conversion-rate is a heavyweight tiebreaker", () => {
    const cold = agent({ userId: "cold", conversionRate: 0 });
    const hot = agent({ userId: "hot", conversionRate: 0.5 });
    const best = rankCandidates(lead, [cold, hot]);
    expect(best?.userId).toBe("hot");
    // Conversion bonus is round(0.5 * 30) = 15
    expect(best?.score).toBe(70 + 20 + 15); // base + capacity slack + conv
  });

  it("appointed carrier matching lead source adds 5", () => {
    const a = rankCandidates(lead, [agent({ userId: "noapt", appointedCarriers: [] })])!;
    const b = rankCandidates(lead, [agent({ userId: "apt", appointedCarriers: ["Humana"] })])!;
    expect(b.score - a.score).toBe(5);
    expect(b.reasons).toContain("carrier:Humana");
  });

  it("capacity slack bonus scales with headroom", () => {
    const full = agent({ userId: "full", capacityLimit: 25, openLeadCount: 24 }); // 1 slot
    const empty = agent({ userId: "empty", capacityLimit: 25, openLeadCount: 0 }); // 25 slots
    const fullScored = rankCandidates(lead, [full])!;
    const emptyScored = rankCandidates(lead, [empty])!;
    // Empty agent's slack bonus is 20; full agent's is round(1/25 * 20) = 1
    expect(emptyScored.score).toBeGreaterThan(fullScored.score);
  });

  it("agent with no states is treated as universal license", () => {
    const result = rankCandidates(lead, [agent({ licensedStates: [] })]);
    expect(result).not.toBeNull();
  });

  it("returns reasons list for explainability", () => {
    const best = rankCandidates(lead, [agent({
      territoryZips: ["33101"],
      conversionRate: 0.3,
      appointedCarriers: ["Humana"],
    })])!;
    expect(best.reasons).toContain("state-match:FL");
    expect(best.reasons).toContain("territory-zip:33101");
    expect(best.reasons.some(r => r.startsWith("capacity-slack:"))).toBe(true);
    expect(best.reasons.some(r => r.startsWith("conv-rate:"))).toBe(true);
    expect(best.reasons).toContain("carrier:Humana");
  });
});
