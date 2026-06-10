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
