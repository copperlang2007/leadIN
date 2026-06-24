// useCanonicalUrl — emit a <link rel="canonical"> for the current route.
//
// Without a canonical url, Google sees every variation of a page —
// /pricing, /pricing?utm_source=twitter, /pricing#tier-pro,
// /pricing?fbclid=...&utm_campaign=jan — as a distinct URL competing
// against itself for the same keyword cluster. The canonical link tag
// tells the crawler "these are all the same page; index this one".
//
// Calling pattern (path is REQUIRED):
//   useCanonicalUrl("/pricing");
//   useCanonicalUrl(`/blog/${slug}`);
//
// We require an explicit path instead of reading window.location.pathname
// because wouter doesn't trigger a remount on client-side navigation
// when only the URL changes — the effect's deps wouldn't see the new
// path and the canonical would stay stuck on the route the user first
// landed on.
//
// The base URL comes from VITE_CANONICAL_ORIGIN at build time (Vite
// substitutes import.meta.env at compile), with leadmarket.app as the
// fallback so dev / CI builds still emit syntactically-valid hrefs.

import { useEffect } from "react";

const FALLBACK_ORIGIN = "https://leadmarket.app";
const LINK_REL = "canonical";

function getOrigin(): string {
  const raw = import.meta.env.VITE_CANONICAL_ORIGIN;
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

export function useCanonicalUrl(path: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const href = buildCanonicalUrl(path);
    // Re-use the existing tag if it's already there so we don't keep
    // appending duplicates on each route change.
    let link = document.head.querySelector(`link[rel="${LINK_REL}"]`);
    const previousHref = link?.getAttribute("href") ?? null;
    // Track whether THIS effect created the tag — drives the cleanup
    // contract: tags we created get removed on unmount, tags that
    // pre-existed get their href restored.
    let createdHere = false;
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", LINK_REL);
      document.head.appendChild(link);
      createdHere = true;
    }
    link.setAttribute("href", href);

    return () => {
      // Unmount cleanup. Two cases:
      //   1. We created the tag (no canonical existed before us). On
      //      unmount, remove it. Otherwise navigating from a route
      //      that uses the hook to a route that doesn't (e.g. /pricing
      //      → /marketplace) would leave a stale canonical pinned to
      //      the old page.
      //   2. A tag pre-existed (probably set by the previous route).
      //      Restore the old href so the next page sees what came
      //      before instead of our value.
      const current = document.head.querySelector(`link[rel="${LINK_REL}"]`);
      if (!current) return;
      if (createdHere) {
        current.parentNode?.removeChild(current);
      } else if (previousHref !== null) {
        current.setAttribute("href", previousHref);
      }
    };
  }, [path]);
}
