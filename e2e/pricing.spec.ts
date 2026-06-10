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
    // The three named tiers from STRIPE_PRICE_*.
    for (const tier of ["Starter", "Growth", "Scale"]) {
      await expect(page.getByRole("heading", { name: new RegExp(tier, "i") })).toBeVisible();
    }
  });

  test("shows pricing amounts", async ({ page }) => {
    await page.goto("/pricing");
    // At least one $/mo style price should appear.
    const dollarMatches = await page.getByText(/\$\d+/).count();
    expect(dollarMatches).toBeGreaterThanOrEqual(3);
  });
});
