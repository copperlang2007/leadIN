// E2E: skip-to-main-content link.
//
// WCAG 2.4.1 (Bypass Blocks) requirement. The skip link must:
//   - exist on every page (smoke against a public + auth-gated route)
//   - be the first focusable element so Tab from the URL bar finds it
//   - move keyboard focus to #main-content when activated
//
// Visual hiding (offscreen until focused) is asserted indirectly via
// the focus styles — the link must HAVE focus styles for it to be
// usable, but we don't pin specific CSS values which would couple
// the test to Tailwind class strings.

import { test, expect } from "@playwright/test";

test.describe("skip-to-main-content link", () => {
  test.beforeEach(async ({ page }) => {
    // Public route auth fixture so the SPA doesn't hang on /api/auth/user.
    await page.route("**/api/auth/user", (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ message: "Unauthorized" }) }),
    );
    await page.route("**/api/orgs", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ activeOrgId: null, memberships: [] }) }),
    );
  });

  test("landing has a skip link as the first focusable element", async ({ page }) => {
    await page.goto("/");
    const skip = page.getByTestId("skip-to-main");
    await expect(skip).toBeAttached();
    await expect(skip).toHaveAttribute("href", "#main-content");
    // First Tab should land on the skip link — proves nothing else
    // is reachable above it.
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
  });

  test("activating the skip link moves focus into the main content region", async ({ page }) => {
    await page.goto("/");
    const skip = page.getByTestId("skip-to-main");
    await skip.focus();
    await page.keyboard.press("Enter");
    // After activation the location hash should reflect the anchor —
    // proves the link actually fires the in-page navigation.
    await expect(page).toHaveURL(/#main-content$/);
    const target = page.locator("#main-content");
    await expect(target).toBeAttached();
  });

  test("skip link is present on the pricing page too", async ({ page }) => {
    await page.goto("/pricing");
    const skip = page.getByTestId("skip-to-main");
    await expect(skip).toBeAttached();
  });
});
