// K1 — Speed-to-Lead Live Auction.
//
// When a high-MediScore lead arrives, eligible agents get a short
// WebSocket window (default 10s) to "Claim" it. The first valid claim
// records a `lead_claims` row with status='pending'; after the window
// closes, all pending claims for the lead are resolved by routing rank
// (delegated to the pure `rankCandidates` in ./routing). The winning
// row flips to 'won', the rest to 'lost', and a `lead_assignments` row
// is written for the winner.
//
// If no claims arrive within the window we fall back to the normal
// `routeLeadToBestAgent` flow and mark any pending rows as 'expired'.
//
// The resolver itself is pure (see `resolveAuctionWinner` below) so the
// race semantics can be exercised without spinning up Postgres. The
// stateful pieces (opening the auction, recording claims, finalising the
// outcome) live in `openAuction`, `recordClaim`, and `resolveAuction`,
// which take an injectable `AuctionDeps` so tests can stub the DB + WS.

import { rankCandidates, type AgentCandidate, type RoutableLead, type RankedCandidate } from "./routing";

// ──────────────────────────────────────────────────────
// Pure types + resolver
// ──────────────────────────────────────────────────────

export interface PendingClaim {
  /** lead_claims.id */
  id: number;
  agentUserId: string;
  /** lead_claims.created_at — earlier wins the tiebreak if scores are equal */
  createdAt: Date;
}

export interface AuctionResolution {
  winnerClaimId: number | null;
  winnerUserId: string | null;
  loserClaimIds: number[];
  matchScore: number;
  reasons: string[];
}

/**
 * Pure resolver. Given the pending claims and the candidate pool (already
 * filtered to *only* claimants), pick the winning claim by routing rank.
 *
 * If two claimants tie on score the earliest createdAt wins — first-come
 * first-served — which matches the "speed-to-lead" intent.
 *
 * Returns `winnerClaimId: null` when no claimant is eligible (the caller
 * should mark everything as 'lost' or 'expired' depending on context).
 */
export function resolveAuctionWinner(
  lead: RoutableLead,
  claims: PendingClaim[],
  candidates: AgentCandidate[],
): AuctionResolution {
  if (claims.length === 0) {
    return { winnerClaimId: null, winnerUserId: null, loserClaimIds: [], matchScore: 0, reasons: [] };
  }

  // Restrict the candidate pool to actual claimants. An agent who didn't
  // press the button doesn't win the auction even if they'd outrank.
  const claimantIds = new Set(claims.map(c => c.agentUserId));
  const claimantCandidates = candidates.filter(c => claimantIds.has(c.userId));

  // Rank within the claimant pool. We loop manually rather than calling
  // `rankCandidates` once because we need per-agent scores to apply the
  // createdAt tiebreaker.
  let best: { userId: string; ranked: RankedCandidate; claim: PendingClaim } | null = null;
  for (const claim of claims) {
    const cand = claimantCandidates.find(c => c.userId === claim.agentUserId);
    if (!cand) continue; // claimant didn't pass the hard filter (e.g. not verified)
    const ranked = rankCandidates(lead, [cand]);
    if (!ranked) continue;
    if (
      !best ||
      ranked.score > best.ranked.score ||
      (ranked.score === best.ranked.score && claim.createdAt.getTime() < best.claim.createdAt.getTime())
    ) {
      best = { userId: claim.agentUserId, ranked, claim };
    }
  }

  if (!best) {
    return {
      winnerClaimId: null,
      winnerUserId: null,
      loserClaimIds: claims.map(c => c.id),
      matchScore: 0,
      reasons: [],
    };
  }

  return {
    winnerClaimId: best.claim.id,
    winnerUserId: best.userId,
    loserClaimIds: claims.filter(c => c.id !== best!.claim.id).map(c => c.id),
    matchScore: best.ranked.score,
    reasons: best.ranked.reasons,
  };
}

// ──────────────────────────────────────────────────────
// Stateful orchestration (DI seams kept narrow)
// ──────────────────────────────────────────────────────

export interface OpenAuctionInput {
  leadId: number;
  orgId: string;
  lead: RoutableLead;
  candidateUserIds: string[];
  windowMs?: number;
}

export interface AuctionOpenedPayload {
  type: "auction_opened";
  leadId: number;
  orgId: string;
  candidateUserIds: string[];
  windowMs: number;
  opensAt: string;
  closesAt: string;
}

export interface AuctionResolvedPayload {
  type: "auction_resolved";
  leadId: number;
  winnerUserId: string | null;
  matchScore: number;
  reasons: string[];
  outcome: "won" | "expired" | "fallback";
}

/** Side-effect surface used by `openAuction`. Mockable in tests.
 *
 * Note: there is no DB placeholder for an open auction. The auction's
 * lifecycle is tracked in-process via `markOpen` / `isOpen` / `clearOpen`.
 * This keeps us from violating the `lead_claims.agent_user_id` FK with a
 * synthetic id, and keeps the 10s window cheap. If the process restarts
 * mid-window, the lead simply falls back to immediate routing on the
 * next ingest — which is fine for a 10s window. */
export interface AuctionDeps {
  // Returns true iff an assignment already exists for this lead (idempotency).
  assignmentExists: (leadId: number) => Promise<boolean>;
  // Returns true iff an auction is currently open in-process for this lead.
  isOpen: (leadId: number) => boolean;
  markOpen: (leadId: number) => void;
  clearOpen: (leadId: number) => void;
  listPendingClaims: (leadId: number) => Promise<PendingClaim[]>;
  hydrateCandidates: (orgId: string, userIds: string[]) => Promise<AgentCandidate[]>;
  markClaim: (claimId: number, status: "won" | "lost" | "expired") => Promise<void>;
  writeAssignment: (input: {
    leadId: number;
    orgId: string;
    agentUserId: string;
    matchScore: number;
    reason: string;
  }) => Promise<void>;
  fallbackRoute: (leadId: number) => Promise<void>;
  broadcastOpened: (payload: AuctionOpenedPayload) => void;
  broadcastResolved: (payload: AuctionResolvedPayload) => void;
  // Schedule the resolution after the window closes. Tests pass a fake
  // scheduler that runs synchronously.
  schedule: (fn: () => void, ms: number) => void;
}

// Module-level "auction open" registry — shared by the DB-backed
// `AuctionDeps` factory in storage.ts and the claim-recording helper.
const openAuctions = new Set<number>();
export function isAuctionOpen(leadId: number): boolean {
  return openAuctions.has(leadId);
}
export function markAuctionOpen(leadId: number): void {
  openAuctions.add(leadId);
}
export function clearAuctionOpen(leadId: number): void {
  openAuctions.delete(leadId);
}

export const DEFAULT_AUCTION_WINDOW_MS = 10_000;

/**
 * Open a live auction for a lead. Inserts a placeholder claim row,
 * broadcasts `auction_opened`, and schedules resolution after the window.
 *
 * Idempotent: if an assignment already exists, or the auction was already
 * opened, this is a no-op.
 */
export async function openAuction(input: OpenAuctionInput, deps: AuctionDeps): Promise<void> {
  if (await deps.assignmentExists(input.leadId)) return;
  if (deps.isOpen(input.leadId)) return;

  const windowMs = input.windowMs ?? DEFAULT_AUCTION_WINDOW_MS;
  const opensAt = new Date();
  const closesAt = new Date(opensAt.getTime() + windowMs);

  deps.markOpen(input.leadId);

  deps.broadcastOpened({
    type: "auction_opened",
    leadId: input.leadId,
    orgId: input.orgId,
    candidateUserIds: input.candidateUserIds,
    windowMs,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
  });

  deps.schedule(() => {
    void resolveAuction(input.leadId, input.orgId, input.lead, deps).catch(err => {
      console.error("[auction] resolve error", { leadId: input.leadId, err });
    });
  }, windowMs);
}

/**
 * Run after the auction window closes: pick a winner, mark losers,
 * write the assignment, and broadcast `auction_resolved`. Falls back to
 * normal routing if no real claims arrived.
 */
export async function resolveAuction(
  leadId: number,
  orgId: string,
  lead: RoutableLead,
  deps: AuctionDeps,
): Promise<AuctionResolvedPayload> {
  // Idempotency: another resolver beat us to it. Either way, the window
  // is over — clear the open marker.
  if (await deps.assignmentExists(leadId)) {
    deps.clearOpen(leadId);
    return {
      type: "auction_resolved",
      leadId,
      winnerUserId: null,
      matchScore: 0,
      reasons: ["already-assigned"],
      outcome: "won",
    };
  }

  const claims = await deps.listPendingClaims(leadId);

  if (claims.length === 0) {
    // No agent clicked Claim — fall back to the normal routing engine
    // so the lead still gets an owner.
    deps.clearOpen(leadId);
    await deps.fallbackRoute(leadId);
    const payload: AuctionResolvedPayload = {
      type: "auction_resolved",
      leadId,
      winnerUserId: null,
      matchScore: 0,
      reasons: ["no-claims"],
      outcome: "fallback",
    };
    deps.broadcastResolved(payload);
    return payload;
  }

  const userIds = Array.from(new Set(claims.map(c => c.agentUserId)));
  const candidates = await deps.hydrateCandidates(orgId, userIds);
  const resolution = resolveAuctionWinner(lead, claims, candidates);

  if (!resolution.winnerClaimId || !resolution.winnerUserId) {
    // Claims arrived but none of them passed the hard filters (e.g.
    // unverified, at capacity). Mark them expired and fall back.
    for (const c of claims) await deps.markClaim(c.id, "expired");
    deps.clearOpen(leadId);
    await deps.fallbackRoute(leadId);
    const payload: AuctionResolvedPayload = {
      type: "auction_resolved",
      leadId,
      winnerUserId: null,
      matchScore: 0,
      reasons: ["no-eligible-claimant"],
      outcome: "fallback",
    };
    deps.broadcastResolved(payload);
    return payload;
  }

  await deps.markClaim(resolution.winnerClaimId, "won");
  for (const id of resolution.loserClaimIds) await deps.markClaim(id, "lost");

  await deps.writeAssignment({
    leadId,
    orgId,
    agentUserId: resolution.winnerUserId,
    matchScore: resolution.matchScore,
    reason: ["auction-win", ...resolution.reasons].join(", "),
  });

  deps.clearOpen(leadId);
  const payload: AuctionResolvedPayload = {
    type: "auction_resolved",
    leadId,
    winnerUserId: resolution.winnerUserId,
    matchScore: resolution.matchScore,
    reasons: resolution.reasons,
    outcome: "won",
  };
  deps.broadcastResolved(payload);
  return payload;
}

/**
 * Determine whether a lead's score + flag combination warrants the
 * auction flow instead of immediate routing. Pure so we can test it.
 */
export function shouldOpenAuction(
  mediscore: number | null | undefined,
  flagEnabled: boolean,
  threshold = 80,
): boolean {
  if (!flagEnabled) return false;
  return (mediscore ?? 0) >= threshold;
}
