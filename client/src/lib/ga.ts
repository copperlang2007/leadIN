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
//   - We bail out if the ID is missing, the literal string "undefined"
//     (Vite's silent failure mode for unset VITE_* vars), or doesn't
//     look like a real GA4 ID (G- followed by 6+ alphanumerics).
//   - When we bail out we install a no-op gtag() shim so call sites
//     downstream (event tracker, conversion hits) don't have to guard
//     `if (window.gtag)`.

const ID_PATTERN = /^G-[A-Z0-9]{6,}$/i;

export function isValidGa4Id(id: string | undefined | null): id is string {
  if (!id) return false;
  if (id === "undefined" || id === "null") return false;
  return ID_PATTERN.test(id);
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function bootGa(): void {
  const id = (import.meta as ImportMeta & {
    env: { VITE_GA_MEASUREMENT_ID?: string };
  }).env.VITE_GA_MEASUREMENT_ID;

  if (!isValidGa4Id(id)) {
    // No-op shim so downstream call sites stay clean.
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = window.gtag ?? (() => {});
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, { send_page_view: true });
}
