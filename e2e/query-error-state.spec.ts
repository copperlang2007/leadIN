// E2E: QueryErrorState branches on marketplace + orders.
//
// PRs #75 / #76 / #78 introduced QueryErrorState so a failed
// /api/leads or /api/orders fetch renders a distinct "couldn't load,
// retry" panel instead of silently collapsing into the empty state
// (which would read as "you have no leads / no orders" — actively
// misleading during an outage).
//
// This was previously only unit-asserted via the component; nothing
// pinned the wired-up page behavior. These specs stub the backend
// with 500s and assert the error UI shows, then stub a recovery and
// assert the retry button re-fetches into real content.
//
// Backend is fully stubbed via page.route — no Express / DB needed.

import { test, expect, type Page } from "@playwright/test";

function authAsUser(page: Page) {
  return Promise.all([
    page.route("**/api/auth/user", (route) =>
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
    ),
    page.route("**/api/orgs", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ activeOrgId: "org-1", memberships: [] }),
      }),
    ),
  ]);
}

test.describe("marketplace query-error state", () => {
  test("renders the error panel (not the empty state) when /api/leads 500s", async ({
    page,
  }) => {
    await authAsUser(page);
    await page.route("**/api/leads*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) }),
    );
    await page.route("**/api/orders", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );

    await page.goto("/marketplace");

    // The error panel shows...
    await expect(page.getByTestId("marketplace-error")).toBeVisible();
    // ...and crucially the empty state does NOT (the whole point of
    // the PR was that an outage shouldn't read as "no leads").
    await expect(page.getByTestId("marketplace-empty")).toHaveCount(0);
  });

  test("retry re-fetches and renders content after recovery", async ({ page }) => {
    await authAsUser(page);
    await page.route("**/api/orders", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );

    // First /api/leads call fails; subsequent calls succeed with an
    // empty list. We flip the behavior after the first hit so the
    // retry button has something healthy to land on.
    let leadsHits = 0;
    await page.route("**/api/leads*", (route) => {
      leadsHits += 1;
      if (leadsHits === 1) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/marketplace");
    await expect(page.getByTestId("marketplace-error")).toBeVisible();

    // Click retry → second fetch succeeds → error panel gone, empty
    // state (zero leads) now renders.
    await page.getByTestId("marketplace-error-retry").click();
    await expect(page.getByTestId("marketplace-error")).toHaveCount(0);
    await expect(page.getByTestId("marketplace-empty")).toBeVisible();
  });
});

test.describe("orders query-error state", () => {
  test("renders the error panel (not the empty state) when /api/orders 500s", async ({
    page,
  }) => {
    await authAsUser(page);
    await page.route("**/api/orders", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) }),
    );

    await page.goto("/orders");

    await expect(page.getByTestId("orders-error")).toBeVisible();
    await expect(page.getByTestId("orders-empty")).toHaveCount(0);
  });
});
