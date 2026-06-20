// useCanonicalUrl — emit a <link rel="canonical"> for the current route.
//
// Without a canonical url, Google sees every variation of a page —
// /pricing, /pricing?utm_source=twitter, /pricing#tier-pro,
// /pricing?fbclid=...&utm_campaign=jan — as a distinct URL competing
// against itself for the same keyword cluster. The canonical link tag
// tells the crawler "these are all the same page; index this one".
//
// Calling pattern:
//   useCanonicalUrl();              // canonical = current pathname
//   useCanonicalUrl("/pricing");    // explicit override
//
// The base URL comes from VITE_CANONICAL_ORIGIN at build time (Vite
// substitutes import.meta.env at compile), with leadmarket.app as the
// fallback so dev / CI builds still emit syntactically-valid hrefs.

import { useEffect } from "react";

const FALLBACK_ORIGIN = "https://leadmarket.app";
const LINK_REL = "canonical";

function getOrigin(): string {
  const raw = (import.meta as ImportMeta & {
    env: { VITE_CANONICAL_ORIGIN?: string };
  }).env.VITE_CANONICAL_ORIGIN;
  if (typeof raw !== "string") return FALLBACK_ORIGIN;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return FALLBACK_ORIGIN;
  return trimmed;
}

/**
 * Build the absolute canonical URL for a given path. Exported pure
 * so the unit tests don't need a DOM.
 */
export function buildCanonicalUrl(pathOverride: string | undefined, origin = getOrigin()): string {
  const normalisedOrigin = origin.replace(/\/+$/, "");
  const path = pathOverride ?? "/";
  // Strip query string + fragment — they shouldn't be part of the
  // canonical (the whole point is to collapse tracked variants).
  const cleanPath = path.split(/[?#]/, 1)[0] || "/";
  const normalised = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
  // Collapse any duplicate slashes (//, ///) into one, but preserve
  // the leading slash.
  const deduped = normalised.replace(/\/+/g, "/");
  return `${normalisedOrigin}${deduped}`;
}

export function useCanonicalUrl(pathOverride?: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const href = buildCanonicalUrl(
      pathOverride ?? (typeof window !== "undefined" ? window.location.pathname : "/"),
    );
    // Re-use the existing tag if it's already there so we don't keep
    // appending duplicates on each route change.
    let link = document.head.querySelector(`link[rel="${LINK_REL}"]`);
    const previousHref = link?.getAttribute("href") ?? null;
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", LINK_REL);
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);

    return () => {
      // On unmount, restore the previous href so a route component
      // leaving the tree doesn't leave its canonical stuck on the
      // next page during transition. If there was no previous tag
      // we don't remove it — leaving it pointing at the old route
      // for one render is less bad than briefly emitting a
      // canonical-less head.
      const current = document.head.querySelector(`link[rel="${LINK_REL}"]`);
      if (current && previousHref !== null) {
        current.setAttribute("href", previousHref);
      }
    };
  }, [pathOverride]);
}
