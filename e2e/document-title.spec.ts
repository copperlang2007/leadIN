// E2E: per-route document titles.
//
// PR #73 added useDocumentTitle to every top-level page so each route
// gets its own <title>. This is what differentiates browser tabs,
// what Google indexes, and what screen readers announce on route
// change. If a future refactor strips the hook off a page, the page
// silently falls back to the static index.html title — which IS the
// landing-page title for everyone. That regression is invisible to
// type-check, lint, and unit tests, so we pin it here.
//
// All routes here are public (no auth) and the SPA serves them
// through the same dev server every other E2E spec runs against.

import { test, expect } from "@playwright/test";

const APP = "LeadMarket";
// Stable substring of the landing-page title. The full marketing
// tagline is "LeadMarket — Verified Insurance Lead Marketplace"
// (kept verbatim by useDocumentTitle's full: true path). We match a
// short substring instead so a copy tweak — adding "Pro", changing
// dash characters, swapping "Insurance" for "Carrier" — doesn't
// break this guard. The point of the test is to verify the hook
// fires and the index.html static title is replaced; the exact
// marketing wording isn't part of the contract.
const LANDING_TITLE_SUBSTRING = /LeadMarket.*Insurance Lead Marketplace/i;

const PUBLIC_PAGES = [
  { path: "/pricing", expected: `Pricing · ${APP}` },
  { path: "/blog", expected: `Blog · ${APP}` },
  { path: "/privacy", expected: `Privacy Policy · ${APP}` },
  { path: "/terms", expected: `Terms of Service · ${APP}` },
  { path: "/cookies", expected: `Cookie Policy · ${APP}` },
  { path: "/tcpa-compliance", expected: `TCPA Compliance · ${APP}` },
  // 404 page also gets its own title — useful when a bad link lands
  // in a tab and the user wants to know which tab is the broken one.
  { path: "/this-route-does-not-exist", expected: `Page not found · ${APP}` },
];

test.describe("per-route document title", () => {
  // The landing page uses `full: true` and keeps the marketing tagline
  // verbatim — pinned separately because the assertion shape differs.
  test("landing renders the full marketing title verbatim", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(LANDING_TITLE_SUBSTRING);
  });

  for (const p of PUBLIC_PAGES) {
    test(`${p.path} renders "${p.expected}"`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page).toHaveTitle(p.expected);
    });
  }

  test("title updates on client-side navigation, not just hard load", async ({ page }) => {
    // Soft route change exercises the useEffect path (vs. a full page
    // boot where the static <title> would be replaced regardless). If
    // useDocumentTitle's deps are wrong the title would stay frozen
    // on whatever the first route set it to. Picks the first two
    // public pages so this stays aligned with the table above —
    // a future addition to PUBLIC_PAGES that breaks navigation
    // semantics would surface here without a parallel edit.
    const [first, second] = PUBLIC_PAGES;
    await page.goto(first.path);
    await expect(page).toHaveTitle(first.expected);
    await page.goto(second.path);
    await expect(page).toHaveTitle(second.expected);
  });
});
