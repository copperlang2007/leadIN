// E2E: landing page smoke test.
//
// Verifies the GTM-critical surface: the page renders, the headline is
// readable, both primary CTAs are visible, and the pricing CTA actually
// navigates. No backend dependency — the SPA renders client-only and the
// CTAs are static or in-app navigations.

import { test, expect } from "@playwright/test";

test.describe("landing page", () => {
  test("renders headline + primary CTAs above the fold", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/insurance leads/i);
    await expect(page.getByRole("button", { name: /get started/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /see pricing/i })).toBeVisible();
  });

  test("trust badges are present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/TCPA Compliant/i)).toBeVisible();
  });

  test("See Pricing CTA navigates to /pricing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /see pricing/i }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("page is responsive at common mobile width (375x812)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    // CTAs stack but stay visible.
    await expect(page.getByRole("button", { name: /get started/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /see pricing/i })).toBeVisible();
  });
});
