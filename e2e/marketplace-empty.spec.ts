// E2E: marketplace empty-state branching.
//
// The marketplace.tsx page renders different empty states depending on
// whether the user has active filters or not. PR #50 consolidated both
// paths onto the shared EmptyState component; this suite locks in the
// behavior so future refactors can't silently break it.
//
// Backend is fully stubbed via page.route so the tests don't depend on
// Express or a live DB.

import { test, expect } from "@playwright/test";

async function stubMarketplaceWithNoLeads(page: import("@playwright/test").Page) {
  // Auth + orgs come back with a logged-in user so the marketplace renders.
  await page.route("**/api/auth/user", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "u-1",
        email: "e2e@test.local",
        firstName: "E2E",
        lastName: "User",
        profile: { licensedStates: ["FL"] },
        role: "user",
      }),
    }),
  );
  await page.route("**/api/orgs", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ activeOrgId: "org-1", memberships: [] }),
    }),
  );
  // The marketplace fetches /api/leads?...; respond with an empty array
  // so the empty state path triggers.
  await page.route("**/api/leads*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/orders", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

test.describe("marketplace empty state", () => {
  test("renders the marketplace-empty container when zero leads", async ({ page }) => {
    await stubMarketplaceWithNoLeads(page);
    await page.goto("/marketplace");
    await expect(page.getByTestId("marketplace-empty")).toBeVisible();
  });

  test("no-filters path surfaces both smart-match and onboarding CTAs", async ({ page }) => {
    await stubMarketplaceWithNoLeads(page);
    await page.goto("/marketplace");
    // Default state: no filters, so the warming-up branch renders.
    await expect(page.getByTestId("empty-smart-match-cta")).toBeVisible();
    await expect(page.getByTestId("empty-onboarding-cta")).toBeVisible();
  });
});
