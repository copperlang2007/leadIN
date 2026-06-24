// E2E smoke: Web App Manifest from PR #101.
//
// The manifest landed as static JSON in client/public — easy to
// accidentally break with a stray comma or a deploy-time path
// rewrite. This spec ensures:
//
//   1. The file is served on /manifest.webmanifest
//   2. It parses as valid JSON
//   3. The fields a browser MUST see to offer "Add to Home Screen"
//      are still present (name, start_url, display, icons)
//   4. The <link rel="manifest"> on the landing page actually
//      points at it
//
// All-cheap assertions — no service worker, no install simulation.
// That'd need separate Playwright project config.

import { test, expect } from "@playwright/test";

test.describe("Web App Manifest", () => {
  test("/manifest.webmanifest returns valid JSON with the PWA-critical fields", async ({
    request,
  }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);

    const ct = res.headers()["content-type"] ?? "";
    // Vite serves the file as application/manifest+json or
    // application/json depending on the path config. Either is
    // acceptable; HTML / text/plain is not.
    expect(ct).toMatch(/json/i);

    const body = await res.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new Error(
        `manifest.webmanifest is not valid JSON: ${(err as Error).message}`,
      );
    }

    // Fields a browser MUST see for the install prompt to fire.
    expect(parsed.name).toBeTruthy();
    expect(parsed.start_url).toBeTruthy();
    expect(parsed.display).toBe("standalone");
    expect(Array.isArray(parsed.icons)).toBe(true);
    expect((parsed.icons as unknown[]).length).toBeGreaterThan(0);
  });

  test("landing <link rel=manifest> points at the served manifest", async ({
    page,
  }) => {
    // Public route auth fixture so the SPA doesn't hang on
    // /api/auth/user (same pattern as other public-page specs).
    await page.route("**/api/auth/user", (route) =>
      route.fulfill({
        status: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
      }),
    );
    await page.goto("/");
    const href = await page
      .locator('link[rel="manifest"]')
      .first()
      .getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");
  });
});
