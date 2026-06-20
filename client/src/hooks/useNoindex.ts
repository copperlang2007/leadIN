// useNoindex — add a <meta name="robots" content="noindex"> to the head
// for the current route.
//
// SPA 404 pages are a known soft-404 problem: when the server returns
// the SPA index.html with HTTP 200 for an unknown URL, Google's
// algorithms have to detect from page content that this is a 404 —
// which they sometimes get wrong, leading to broken URLs landing in
// the index and showing up in search results.
//
// Adding `<meta name="robots" content="noindex">` tells the crawler
// explicitly "skip this page". We mount it on:
//   - The 404 page (so error-result URLs don't pollute the index)
//   - Any future page that's reachable but shouldn't be in search
//     (private content surfaces, etc).
//
// On unmount the meta tag is removed so a route that doesn't opt
// out of indexing doesn't inherit the noindex from the previous one.

import { useEffect } from "react";

const META_NAME = "robots";
const NOINDEX_VALUE = "noindex, nofollow";

export function useNoindex(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    let meta = document.head.querySelector(`meta[name="${META_NAME}"]`);
    const previousContent = meta?.getAttribute("content") ?? null;
    let createdHere = false;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", META_NAME);
      document.head.appendChild(meta);
      createdHere = true;
    }
    meta.setAttribute("content", NOINDEX_VALUE);

    return () => {
      const current = document.head.querySelector(`meta[name="${META_NAME}"]`);
      if (!current) return;
      // Same ownership rule as useCanonicalUrl: if THIS effect created
      // the tag, remove it on unmount. Otherwise restore the previous
      // content so the route that came before doesn't inherit our
      // noindex.
      if (createdHere) {
        current.parentNode?.removeChild(current);
      } else if (previousContent !== null) {
        current.setAttribute("content", previousContent);
      }
    };
  }, []);
}
