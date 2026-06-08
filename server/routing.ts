// Pure agent-ranking logic. The storage layer collects candidate state from
// the DB then delegates to `rankCandidates` — keeping the math testable
// without spinning up Postgres.

export interface RoutableLead {
  state: string;
  zipCode: string;
  source: string;
  compatibilityScore: number;
}

export interface AgentCandidate {
  userId: string;
  licensedStates: string[];
  appointedCarriers: string[];
  territoryZips: string[];
  territoryCounties: string[];
  capacityLimit: number;
  openLeadCount: number;
  conversionRate: number; // 0..1
  acceptingLeads: boolean;
  verified: boolean;
  // Optional — passed in by `routeLeadToBestAgent` after a SQL aggregate.
  // Defaults to 0 so existing callers/tests don't have to know about it.
  // Clamped at the caller to [-50, 100].
  reputationScore?: number;
}

export interface RankedCandidate {
  userId: string;
  score: number;
  reasons: string[];
}

// Returns the best candidate or null if none qualify. Hard filters:
//   - verified
//   - accepting leads
//   - licensed in lead.state (unless agent has no states declared)
//   - if territory_zips/counties defined, lead.zipCode must be in zips
//   - openLeadCount < capacityLimit
// Soft signals add to score:
//   - territory_zips match (+10)
//   - capacity slack proportional bonus (0..20)
//   - conversion rate (0..30)
//   - carrier appointment matches lead.source (+5)
export function rankCandidates(lead: RoutableLead, candidates: AgentCandidate[]): RankedCandidate | null {
  let best: RankedCandidate | null = null;

  for (const a of candidates) {
    if (!a.verified) continue;
    if (!a.acceptingLeads) continue;

    const stateOk = a.licensedStates.length === 0 || a.licensedStates.includes(lead.state);
    if (!stateOk) continue;

    const territoryDefined = a.territoryZips.length > 0 || a.territoryCounties.length > 0;
    const territoryOk = !territoryDefined || a.territoryZips.includes(lead.zipCode);
    if (!territoryOk) continue;

    if (a.openLeadCount >= a.capacityLimit) continue;

    const reasons: string[] = [];
    let score = lead.compatibilityScore;

    reasons.push(`state-match:${lead.state}`);

    if (a.territoryZips.includes(lead.zipCode)) {
      score += 10;
      reasons.push(`territory-zip:${lead.zipCode}`);
    }

    const slack = a.capacityLimit - a.openLeadCount;
    const slackBonus = Math.min(20, Math.round((slack / a.capacityLimit) * 20));
    score += slackBonus;
    reasons.push(`capacity-slack:${slack}/${a.capacityLimit}`);

    const convBonus = Math.round(a.conversionRate * 30);
    score += convBonus;
    if (convBonus > 0) reasons.push(`conv-rate:${(a.conversionRate * 100).toFixed(1)}%`);

    if (a.appointedCarriers.some(c => c.toLowerCase() === lead.source.toLowerCase())) {
      score += 5;
      reasons.push(`carrier:${lead.source}`);
    }

    // Reputation contributes at half-weight so a rep range of [-50, 100]
    // translates to a routing nudge of [-25, +50] — meaningful but not
    // dominant against territory/conversion-rate signal.
    const rep = a.reputationScore ?? 0;
    if (rep !== 0) {
      const repBonus = Math.round(rep * 0.5);
      score += repBonus;
      reasons.push(`reputation:${rep}`);
    }

    if (!best || score > best.score) {
      best = { userId: a.userId, score, reasons };
    }
  }

  return best;
}
