// E2E: cross-page navigation + 404.
//
// Verifies the SPA routes wire up correctly so we catch regressions
// where adding a new page silently breaks an existing route.

import { test, expect } from "@playwright/test";

test.describe("navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/user", (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ message: "Unauthorized" }) }),
    );
    await page.route("**/api/orgs", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ activeOrgId: null, memberships: [] }) }),
    );
  });

  test("unknown route renders the 404 page", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    // not-found.tsx renders a friendly 404 message.
    await expect(page.locator("body")).toContainText(/404|not found|page not found/i);
  });

  test("404 page emits <meta name=robots content=noindex>", async ({ page }) => {
    // SPA 404s come back as HTTP 200 — the SEO crawler can't tell from
    // the status code that the page is missing. The noindex meta tag
    // is what stops Google from indexing typo / deprecated URLs that
    // land on the 404 page. Regression-prone if useNoindex ever gets
    // removed from not-found.tsx.
    await page.goto("/this-route-does-not-exist");
    const robotsContent = await page
      .locator('meta[name="robots"]')
      .first()
      .getAttribute("content");
    expect(robotsContent).toMatch(/noindex/i);
  });

  test("404 noindex meta is removed after navigating to a real route", async ({ page }) => {
    // The hook's cleanup contract says: remove the meta on unmount
    // when this hook created it. If broken, every page the user
    // navigates to after hitting a 404 would inherit the noindex —
    // catastrophic for SEO.
    await page.goto("/this-route-does-not-exist");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
    await page.goto("/pricing");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });

  test("404 CTA reads 'Back to home', not 'Back to marketplace'", async ({ page }) => {
    // The home route / resolves to Landing for guests and Marketplace
    // for signed-in users. "Back to home" is accurate for both;
    // "Back to marketplace" was misleading for guests (who got Landing).
    await page.goto("/this-route-does-not-exist");
    const cta = page.getByTestId("not-found-home-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/back to home/i);
    await expect(cta).not.toContainText(/marketplace/i);
  });

  test("landing → pricing → landing round-trips cleanly", async ({ page }) => {
    await page.goto("/");
    // .first() against strict-mode duplicates added by the landing footer
     // CTA in #26 and the public footer in #37.
    await page.getByRole("button", { name: /see pricing/i }).first().click();
    await expect(page).toHaveURL(/\/pricing$/);
    // Logo / brand link returns to the landing page. .first() picks the
    // header LeadMarket link (vs the footer brand block).
    const brand = page.getByRole("link", { name: /LeadMarket/i }).first();
    await brand.click();
    await expect(page).toHaveURL(/\/$/);
  });
});
