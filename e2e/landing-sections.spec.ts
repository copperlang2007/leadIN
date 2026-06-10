// E2E: landing page expanded sections (post-#26).
//
// Locks in the long-scroll surface — stats strip, How it works,
// differentiators, testimonial, and FAQ accordion. Catches the
// regression where one of these sections silently disappears
// in a future refactor.

import { test, expect } from "@playwright/test";

test.describe("landing — expanded sections", () => {
  test("stats strip shows all four metric tiles", async ({ page }) => {
    await page.goto("/");
    // The hero stat labels — locked to the copy in landing.tsx STATS array.
    await expect(page.getByText(/Paid out to agents/i)).toBeVisible();
    await expect(page.getByText(/Verified leads delivered/i)).toBeVisible();
    await expect(page.getByText(/TCPA-compliant rate/i)).toBeVisible();
    await expect(page.getByText(/Agent satisfaction/i)).toBeVisible();
  });

  test("How it works section renders three numbered steps", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /From signup to first call/i })).toBeVisible();
    await expect(page.getByText(/Filter to your fit/i)).toBeVisible();
    await expect(page.getByText(/Buy and dial/i)).toBeVisible();
    await expect(page.getByText(/Dispute and replace/i)).toBeVisible();
  });

  test("Differentiator grid renders all four cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Chain of custody on every lead/i)).toBeVisible();
    await expect(page.getByText(/AI persona before you dial/i)).toBeVisible();
    await expect(page.getByText(/Vendor scorecards in your hand/i)).toBeVisible();
    await expect(page.getByText(/Dispute-then-replace, not dispute-then-argue/i)).toBeVisible();
  });

  test("FAQ accordion expands when clicked", async ({ page }) => {
    await page.goto("/");
    // The first FAQ trigger should be visible after scrolling.
    const firstQuestion = page.getByRole("button", { name: /What kinds of insurance leads can I buy/i });
    await firstQuestion.scrollIntoViewIfNeeded();
    await expect(firstQuestion).toBeVisible();
    await firstQuestion.click();
    // After click, the answer is revealed.
    await expect(page.getByText(/Medicare Advantage, Medicare Supplement, ACA/i)).toBeVisible();
  });

  test("Final CTA section renders with $25 free credits offer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Start with \$25 in free credits/i)).toBeVisible();
    await expect(page.getByText(/No contracts/i)).toBeVisible();
  });
});
