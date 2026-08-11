import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "capture.config.json"), "utf8"));

// Generic screenshot-capture config. Boots your app (capture.config.json →
// startCommand) and runs capture.spec.ts against it. No app code here — only
// config — so this file is the same across repos.
export default defineConfig({
  testDir: ".",
  testMatch: /capture\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: (cfg as any).baseURL ?? "http://127.0.0.1:8000",
    viewport: (cfg as any).viewport ?? { width: 1320, height: 880 },
    deviceScaleFactor: (cfg as any).deviceScaleFactor ?? 2,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: (cfg as any).startCommand,
    url: ((cfg as any).baseURL ?? "http://127.0.0.1:8000") + ((cfg as any).healthPath ?? "/"),
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
