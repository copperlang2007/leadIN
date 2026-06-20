// Google Analytics 4 boot.
//
// Before this module, client/index.html had a hard-coded GA snippet
// pointing at G-LEADMARKET01 — a placeholder, not a real measurement
// ID. Every dev session, every CI run, every staging page-view fired
// gtag against an ID that doesn't exist, polluting GA with 404s and
// giving prod no clean dataset to read.
//
// Boot rules:
//   - The measurement ID comes from import.meta.env.VITE_GA_MEASUREMENT_ID.
//     Vite injects this at build time (anything VITE_* gets statically
//     replaced — the prod bundle bakes the real ID in, dev bundles get
//     undefined).
//   - We trim the value before validating so a copy-paste env var with
//     stray whitespace still resolves.
//   - We bail out if the trimmed ID is missing, the literal string
//     "undefined" / "null" (Vite's silent failure modes for unset
//     VITE_* vars), or doesn't look like a real GA4 ID (G- followed by
//     6+ alphanumerics).
//   - When we bail out we install a no-op gtag() shim so call sites
//     downstream (event tracker, conversion hits) don't have to guard
//     `if (window.gtag)`.
//   - The script tag injection is idempotent: a second bootGa() call
//     is a no-op once the first has installed the gtag script.

const ID_PATTERN = /^G-[A-Z0-9]{6,}$/i;
const SCRIPT_MARKER_ATTR = "data-lcp-ga";

export function isValidGa4Id(id: string | undefined | null): id is string {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (trimmed === "undefined" || trimmed === "null") return false;
  return ID_PATTERN.test(trimmed);
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function bootGa(): void {
  // SSR / test-environment guard. The SPA never renders server-side
  // today, but this means a future Node-side import-for-side-effects
  // won't crash on missing window/document.
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const raw = (import.meta as ImportMeta & {
    env: { VITE_GA_MEASUREMENT_ID?: string };
  }).env.VITE_GA_MEASUREMENT_ID;

  if (!isValidGa4Id(raw)) {
    // No-op shim so downstream call sites stay clean.
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = window.gtag ?? (() => {});
    return;
  }

  const id = raw.trim();

  // Idempotency: a second bootGa() call would otherwise attach a second
  // gtag script tag and re-fire config. Use a marker attribute so we
  // can recognise our own previous insertion without relying on the
  // src URL (which could legitimately appear from a vendor pixel).
  if (document.querySelector(`script[${SCRIPT_MARKER_ATTR}]`)) {
    return;
  }

  // DNS prefetch warms the resolver for googletagmanager.com so the
  // immediately-following <script src> doesn't pay the lookup cost.
  // We add this INSIDE bootGa (not in index.html) so the hint only
  // fires when GA is actually enabled — no third-party leak in dev/CI
  // or for users whose VITE_GA_MEASUREMENT_ID is unset.
  const prefetch = document.createElement("link");
  prefetch.rel = "dns-prefetch";
  prefetch.href = "https://www.googletagmanager.com";
  document.head.appendChild(prefetch);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  script.setAttribute(SCRIPT_MARKER_ATTR, "1");
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, { send_page_view: true });
}
