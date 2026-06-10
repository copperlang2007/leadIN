// Schema drift detector.
//
// The CI step that runs `drizzle-kit generate --out=./.ci-migrations`
// against an empty output folder always regenerates the full history —
// it doesn't tell us whether shared/schema.ts is in sync with the
// migrations we've already committed.
//
// This script does the right thing: copy the committed migrations into
// a temp dir, run `drizzle-kit generate` against that, and assert that
// no new .sql file is produced. A new file means someone edited
// shared/schema.ts without running `npm run db:generate` — the kind of
// silent drift that lands in main and breaks the next deploy.
//
// Run via `npm run check:migrations`. Designed to work locally and in CI.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SRC_MIGRATIONS = path.join(ROOT, "migrations");

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

function listSqlFiles(dir: string): Set<string> {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir).filter((f) => f.endsWith(".sql")),
  );
}

function main(): void {
  if (!fs.existsSync(SRC_MIGRATIONS)) {
    console.error(`❌ ${SRC_MIGRATIONS} not found — run from repo root.`);
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lcp-schema-sync-"));
  const tmpMigrations = path.join(tmp, "migrations");

  try {
    copyDirSync(SRC_MIGRATIONS, tmpMigrations);
    const before = listSqlFiles(tmpMigrations);

    const result = spawnSync(
      "npx",
      [
        "drizzle-kit",
        "generate",
        "--dialect=postgresql",
        "--schema=./shared/schema.ts",
        `--out=${tmpMigrations}`,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );

    if (result.status !== 0) {
      console.error("❌ drizzle-kit generate failed:");
      console.error(result.stderr);
      console.error(result.stdout);
      process.exit(result.status ?? 1);
    }

    const after = listSqlFiles(tmpMigrations);
    const newFiles = [...after].filter((f) => !before.has(f));

    if (newFiles.length === 0) {
      console.log(`✅ schema in sync — ${after.size} committed migrations, no new SQL generated.`);
      return;
    }

    console.error("❌ Schema drift detected. drizzle-kit would have generated:");
    for (const f of newFiles) console.error(`   - ${f}`);
    console.error("");
    console.error("Run `npm run db:generate` locally, commit the new migration, and push again.");
    process.exit(1);
  } finally {
    // Clean up the temp dir so successive runs don't pollute /tmp.
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

main();
