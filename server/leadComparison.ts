// Session-scoped lead comparison list (max 4 leads).
//
// Harvested from the `leadmarket` sibling repo as part of the consolidation
// into this app (see docs/adr/0001-repo-consolidation-strategy.md). The list
// lives on the express session so it works for anonymous browsing, mirroring
// the source behaviour. These helpers are pure so they can be unit-tested
// without an HTTP/session round-trip; the route handlers own the session I/O.

// Single source of truth shared with the client (marketplace compare UI).
import { MAX_COMPARE } from "@shared/constants";
export { MAX_COMPARE };

export type CompareResult =
  | { ok: true; list: number[] }
  | { ok: false; status: number; message: string; list: number[] };

/**
 * Add a lead id to the comparison list.
 * - 409 if the lead is already present.
 * - 400 if the list is already full (MAX_COMPARE).
 * Never mutates the input array.
 */
export function addToComparison(current: number[], leadId: number): CompareResult {
  const list = [...current];
  if (list.includes(leadId)) {
    return { ok: false, status: 409, message: "Lead already in comparison", list };
  }
  if (list.length >= MAX_COMPARE) {
    return {
      ok: false,
      status: 400,
      message: `Comparison list is full (max ${MAX_COMPARE})`,
      list,
    };
  }
  list.push(leadId);
  return { ok: true, list };
}

/** Remove a lead id from the comparison list. Never mutates the input array. */
export function removeFromComparison(current: number[], leadId: number): number[] {
  return current.filter((id) => id !== leadId);
}
