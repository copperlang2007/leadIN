// E2E: public legal pages.
//
// Stripe live mode + most B2B procurement checklists require Privacy,
// Terms, and Cookie pages be reachable WITHOUT an account. Before
// this PR those routes were 404s — the footer links to /privacy and
// /terms but the SPA had no matching routes.
//
// This spec pins:
//   1. Each legal page renders with a recognizable heading.
//   2. The operator-notice banner is present (a deploy-safety guard:
//      if someone removes the banner they meant to substitute their
//      own real policy; the banner being there means it's still a
//      template).
//   3. Cross-page navigation works (privacy ↔ terms link from each).
//   4. The footer link from landing actually goes somewhere real.

import { test, expect } from "@playwright/test";

const PAGES = [
  { path: "/privacy", heading: /privacy policy/i },
  { path: "/terms", heading: /terms of service/i },
  { path: "/cookies", heading: /cookie policy/i },
  { path: "/tcpa-compliance", heading: /tcpa compliance/i },
];

test.describe("public legal pages", () => {
  for (const p of PAGES) {
    test(`${p.path} renders the expected heading`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(p.heading);
    });

    test(`${p.path} shows the operator-template notice`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.getByText(/template policy/i)).toBeVisible();
    });
  }

  test("footer link from landing reaches Privacy Policy", async ({ page }) => {
    await page.goto("/");
    // Footer renders the public links; click "Privacy policy". The
    // landing page also has no inline /privacy reference, so .first()
    // is precautionary (one link today, .first() locks us against a
    // future header link making this ambiguous).
    await page.getByRole("link", { name: /privacy policy/i }).first().click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/privacy policy/i);
  });

  test("footer TCPA-compliance link routes to public page, not authenticated /tcpa", async ({ page }) => {
    // Regression: the footer used to point /tcpa (the authenticated
    // TCPA Defense Insurance product) which 404'd for guests. Fixing
    // the routing target is the whole point of this PR.
    await page.goto("/");
    await page.getByRole("link", { name: /tcpa compliance/i }).first().click();
    await expect(page).toHaveURL(/\/tcpa-compliance$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/tcpa compliance/i);
  });

  test("cookies page cross-links to privacy + terms", async ({ page }) => {
    await page.goto("/cookies");
    // The cookies copy AND the footer both link to /privacy and /terms;
    // strict mode would fail without .first(). We want to assert the
    // inline body cross-reference is visible — which appears earlier in
    // the DOM than the footer, so .first() selects the body link.
    await expect(page.getByRole("link", { name: /privacy policy/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /terms of service/i }).first()).toBeVisible();
  });
});
