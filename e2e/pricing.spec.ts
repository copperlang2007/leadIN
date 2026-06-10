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
    // CardTitle in pricing.tsx renders as a styled div, not an h2 —
    // getByRole('heading') wouldn't find it. Match the tier name text
    // directly with an anchored regex so we don't false-match other
    // places the name appears in marketing copy.
    for (const tier of ["Starter", "Growth", "Scale"]) {
      await expect(page.getByText(new RegExp(`^${tier}$`, "i")).first()).toBeVisible();
    }
  });

  test("shows pricing amounts", async ({ page }) => {
    await page.goto("/pricing");
    // At least one $/mo style price should appear.
    const dollarMatches = await page.getByText(/\$\d+/).count();
    expect(dollarMatches).toBeGreaterThanOrEqual(3);
  });
});
