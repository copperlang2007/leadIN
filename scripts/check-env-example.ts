import fs from "node:fs";
import path from "node:path";

const ROOTS = ["server", "shared"];
const re = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const seen = new Set<string>();

function walk(dir: string) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(ent.name) && !p.endsWith(".test.ts")) {
      const src = fs.readFileSync(p, "utf8");
      let m;
      while ((m = re.exec(src))) seen.add(m[1]);
    }
  }
}
ROOTS.forEach(walk);

const example = fs.readFileSync(".env.example", "utf8");
const declared = new Set(
  example
    .split("\n")
    .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean) as string[],
);

const missing = [...seen].filter((k) => !declared.has(k)).sort();
if (missing.length) {
  console.error("❌ .env.example is missing these env vars referenced in code:");
  missing.forEach((k) => console.error("  - " + k));
  process.exit(1);
}
console.log(`✅ .env.example covers ${seen.size} env vars referenced in code.`);
