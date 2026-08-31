// One-time, idempotent provisioning script for the house vendor the
// first-party quote funnel (server/routes.ts POST /api/quote) attributes
// captured leads to. QUOTE_TOOL_VENDOR_ID must point at this row's id.
//
// Safe to run against any environment, including production — it's a
// check-then-insert (never duplicates, never touches an existing row) and
// makes exactly one write. Run it once per database:
//
//   npx tsx scripts/ensure-house-vendor.ts
//
// It prints the vendor id to set as QUOTE_TOOL_VENDOR_ID. Run it again any
// time (e.g. against a fresh Neon branch) — it will just report the
// existing id instead of creating a duplicate.

import { db, closePool } from "../server/db";
import { vendors } from "@shared/schema";
import { eq } from "drizzle-orm";

const HOUSE_VENDOR_NAME = "LeadMarket Direct";

async function main() {
  const [existing] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.name, HOUSE_VENDOR_NAME));

  if (existing) {
    console.log(`Already exists — QUOTE_TOOL_VENDOR_ID=${existing.id} ("${existing.name}")`);
    return;
  }

  const [created] = await db
    .insert(vendors)
    .values({ name: HOUSE_VENDOR_NAME, verified: true, isExclusive: true })
    .returning();

  console.log(`Created — QUOTE_TOOL_VENDOR_ID=${created.id} ("${created.name}")`);
}

main()
  .catch((err) => {
    console.error("Failed to provision house vendor:", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
