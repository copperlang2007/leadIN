import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Generic, config-driven screenshot capture. Reads capture.config.json: runs the
// `seed` API calls (capturing returned ids), then screenshots each `screen` into
// ../shots. Templating: any string may contain {{ids.KEY}} where an earlier seed
// step had "saveIdAs": "KEY". No app-specific code lives here.

type Seed = { path: string; body?: unknown; saveIdAs?: string };
type Screen = { name: string; path: string; fullPage?: boolean };
const C = JSON.parse(
  fs.readFileSync(path.join(__dirname, "capture.config.json"), "utf8")
) as { seed?: Seed[]; screens: Screen[] };

const OUT = path.resolve(__dirname, "../shots");
fs.mkdirSync(OUT, { recursive: true });

const ids: Record<string, string> = {};
const fill = (s: string) => s.replace(/\{\{ids\.([a-zA-Z0-9_]+)\}\}/g, (_, k) => ids[k] ?? "");

test.describe.configure({ mode: "serial" });

test("seed", async ({ request }) => {
  for (const step of C.seed ?? []) {
    const res = await request.post(fill(step.path), { data: step.body ?? {} });
    expect(res.ok(), `seed ${step.path} → ${res.status()}`).toBeTruthy();
    if (step.saveIdAs) {
      const json = await res.json().catch(() => ({}));
      if (json && json.id) ids[step.saveIdAs] = json.id;
    }
  }
});

for (const screen of C.screens) {
  test(`shot:${screen.name}`, async ({ page }) => {
    await page.goto(fill(screen.path));
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${screen.name}.png`), fullPage: !!screen.fullPage });
  });
}
