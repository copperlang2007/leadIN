// Pure matching logic for Saved-Search Alerts.
//
// Kept free of DB/IO so it can be unit-tested exhaustively. Storage
// (server/storage.ts) uses this to decide which active saved searches a
// newly-ingested lead should notify.

import type { SavedSearchCriteria } from "@shared/schema";

// The subset of lead fields the matcher inspects. Accepts the full Lead row
// (price is a decimal string in the DB) as well as lighter shapes.
export interface MatchableLead {
  type: string;
  state: string;
  price: string | number;
  mediscore?: number | null;
  verified?: boolean | null;
}

/**
 * Returns true when `lead` satisfies every constraint present in `criteria`.
 * Omitted / empty criteria fields do not constrain the match.
 */
export function leadMatchesCriteria(
  lead: MatchableLead,
  criteria: SavedSearchCriteria | null | undefined,
): boolean {
  if (!criteria) return true;

  // Lead type must be one of the requested types (when any are given).
  if (criteria.types && criteria.types.length > 0) {
    if (!criteria.types.includes(lead.type)) return false;
  }

  // Lead state must be one of the requested states (when any are given).
  if (criteria.states && criteria.states.length > 0) {
    if (!criteria.states.includes(lead.state)) return false;
  }

  // Price band — each bound is optional and inclusive.
  const price = Number(lead.price);
  if (criteria.minPrice != null) {
    if (!Number.isFinite(price) || price < criteria.minPrice) return false;
  }
  if (criteria.maxPrice != null) {
    if (!Number.isFinite(price) || price > criteria.maxPrice) return false;
  }

  // MediScore floor (inclusive).
  if (criteria.minMediscore != null) {
    const mediscore = lead.mediscore ?? 0;
    if (mediscore < criteria.minMediscore) return false;
  }

  // Verified-only filter.
  if (criteria.verifiedOnly) {
    if (lead.verified !== true) return false;
  }

  return true;
}

// Thrown by storage.createSavedSearch when the caller is already at their
// active-search cap; the route maps it to a 409.
export const ERR_SAVED_SEARCH_CAP = "SAVED_SEARCH_CAP";

// Hard fan-out ceiling: notifyMatchingSavedSearches never scans/notifies more
// than this many saved searches per ingested lead, so one lead can't block the
// event loop or flood notifications at scale. When hit, it's logged.
export const SAVED_SEARCH_FANOUT_CAP = 500;
