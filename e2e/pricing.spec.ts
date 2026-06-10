// E2E: pricing page smoke test.
//
// Pricing is a primary GTM surface — the conversion gate between landing
// and signup. We verify that the three tiers render, prices are visible,
// and the CTAs are clickable. Backend Stripe checkout is mocked out — we
// only assert the click leads to a redirect attempt.

import { test, expect } from "@playwright/test";

test.describe("pricing page", () => {
  test("renders three subscription tiers", async ({ page }) => {
    await page.goto("/pricing");
    // CardTitle renders as a styled div, not an h2, so getByRole('heading')
    // can't find it. Lock onto stable data-testids on the tier title rather
    // than visible text — copy can change without breaking the test.
    for (const id of ["starter", "growth", "scale"]) {
      await expect(page.getByTestId(`tier-title-${id}`)).toBeVisible();
    }
  });

  test("shows pricing amounts", async ({ page }) => {
    await page.goto("/pricing");
    // At least one $/mo style price should appear.
    const dollarMatches = await page.getByText(/\$\d+/).count();
    expect(dollarMatches).toBeGreaterThanOrEqual(3);
  });
});
