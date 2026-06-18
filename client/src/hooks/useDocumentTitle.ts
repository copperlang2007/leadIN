// useDocumentTitle — set <title> per route, restore on unmount.
//
// Every public + authenticated page in the app used to render the
// same <title> from index.html ("LeadMarket — Verified Insurance Lead
// Marketplace"). Bad for browser tabs (you can't tell tabs apart with
// marketplace + pricing + orders open), bad for SEO (every page indexes
// under the same title), bad for screen-reader users (announcement is
// identical regardless of route).
//
// Calling pattern:
//   useDocumentTitle("Pricing");
//   useDocumentTitle("Lead 42 — Marketplace");
//   useDocumentTitle({ part: "Custom Title", full: true });  // verbatim

import { useEffect } from "react";

export const APP_NAME = "LeadMarket";
const FULL_FALLBACK = "LeadMarket — Verified Insurance Lead Marketplace";

export type TitleOptions = string | { part: string; full?: boolean };

export function buildTitle(opts: TitleOptions): string {
  if (typeof opts === "string") return `${opts} · ${APP_NAME}`;
  if (opts.full) return opts.part;
  return `${opts.part} · ${APP_NAME}`;
}

export function useDocumentTitle(opts: TitleOptions): void {
  const part = typeof opts === "string" ? opts : opts.part;
  const full = typeof opts === "string" ? false : !!opts.full;
  useEffect(() => {
    const previous = document.title;
    document.title = buildTitle(opts);
    return () => {
      // Restore on unmount so a route component leaving the tree
      // doesn't leave its title stuck on the new page during the
      // brief transition.
      document.title = previous || FULL_FALLBACK;
    };
    // We intentionally key on (part, full) instead of (opts) so that
    // callers passing a fresh object literal every render don't trigger
    // an effect on every render.
  }, [part, full]);
}
