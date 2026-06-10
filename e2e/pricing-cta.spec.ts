// E2E: pricing page CTAs.
//
// Locks in the conversion buttons on the highest-impact GTM surface.
// We don't sign anyone in here — we just verify the unauthenticated
// state renders the right buttons. The /api/orgs response is stubbed
// so we don't depend on the Express server being up.

import { test, expect } from "@playwright/test";

test.describe("pricing CTAs (unauthenticated)", () => {
  test.beforeEach(async ({ page }) => {
    // Stub the auth + orgs endpoints so the page boots in a stable
    // unauthenticated state without a backend.
    await page.route("**/api/auth/user", (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ message: "Unauthorized" }) }),
    );
    await page.route("**/api/orgs", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ activeOrgId: null, memberships: [] }) }),
    );
  });

  test("shows Sign in CTA for every subscription tier", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByTestId("button-signin-starter")).toBeVisible();
    await expect(page.getByTestId("button-signin-growth")).toBeVisible();
    await expect(page.getByTestId("button-signin-scale")).toBeVisible();
  });

  test("Pay-per-lead CTA navigates inside the SPA (no full reload)", async ({ page }) => {
    await page.goto("/pricing");
    // The 'Add funds' link routes to "/" — wouter SPA nav, not a full
    // page load. We assert by clicking and waiting for the URL change.
    const addFunds = page.getByRole("link", { name: /Add funds/i });
    await expect(addFunds).toBeVisible();
    await addFunds.click();
    await expect(page).toHaveURL(/\/$/);
  });
});
