import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests. Runs against the Vite client-only dev server — no
// Express, no DB. Tests intercept network requests for backend calls
// so they can verify UI behavior in isolation. Full-stack E2E (real
// auth + DB) can land later as a separate config (playwright.full.config.ts)
// that runs the actual server boot.

const PORT = process.env.PLAYWRIGHT_PORT ?? "5000";
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Each test gets its own browser context; tests don't share state.
  fullyParallel: true,
  // Fail the CI build if .only is left in committed code.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    // Tighter than the 30s default — keeps a flake fast.
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Don't auto-start the server in CI when PLAYWRIGHT_BASE_URL is set
  // externally; otherwise spawn a Vite dev server for the SPA.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run dev:client -- --port ${PORT}`,
        port: parseInt(PORT, 10),
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
