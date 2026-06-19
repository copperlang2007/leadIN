// Nightly re-check: every unsold lead older than 24h gets its phone re-run
// against the DNC list. Phones can be added to the DNC registry after a
// lead is ingested; this keeps the marketplace honest.

import { db } from "./db";
import { leads } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { checkDnc } from "./dncCompliance";
import { recomputeAndPersistMediScore } from "./mediscore";
import { registerCron } from "./lib/cronRegistry";

const RECHECK_AGE_HOURS = 24;
const BATCH_LIMIT = 500;

export interface RecheckResult {
  scanned: number;
  flipped: number;
  /** Number of leads we skipped because the DNC vendor lookup failed.
   *  These rows keep their existing dncFlagged + dncCheckedAt so the
   *  next recheck run retries them. Surfaces in the operator log so
   *  ops can correlate a vendor outage with the cron output. */
  vendorErrors: number;
}

export async function runDncRecheck(): Promise<RecheckResult> {
  const cutoff = new Date(Date.now() - RECHECK_AGE_HOURS * 60 * 60 * 1000);

  const stale = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.sold, false),
        eq(leads.removed, false),
        sql`(${leads.dncCheckedAt} IS NULL OR ${leads.dncCheckedAt} < ${cutoff})`,
      ),
    )
    .limit(BATCH_LIMIT);

  let flipped = 0;
  let vendorErrors = 0;
  for (const lead of stale) {
    if (!lead.consumerPhone) continue;
    const result = await checkDnc(lead.consumerPhone);

    if (result.source === "vendor-error") {
      // Vendor is down — checkDnc returns flagged=true defensively so
      // the dial-time gate stays safe, but the recheck must NOT
      // persist that across the whole batch. If we wrote flagged=true
      // for every lead here, a single vendor outage would empty the
      // marketplace for at least 24h (the next recheck cycle).
      // Skip instead so dncCheckedAt stays stale and the next run
      // retries the same set of leads.
      vendorErrors += 1;
      continue;
    }

    const newFlagged = result.flagged;
    if (newFlagged !== lead.dncFlagged) flipped += 1;

    await db
      .update(leads)
      .set({ dncFlagged: newFlagged, dncCheckedAt: new Date() })
      .where(eq(leads.id, lead.id));

    if (flipped > 0 && newFlagged !== lead.dncFlagged) {
      // MediScore depends on dnc_clean — recompute lazily, ignoring errors.
      recomputeAndPersistMediScore(lead.id).catch(() => {});
    }
  }

  if (stale.length > 0) {
    console.log(
      `[dnc-recheck] scanned ${stale.length} leads, flipped ${flipped}, vendor errors ${vendorErrors}`,
    );
  }
  return { scanned: stale.length, flipped, vendorErrors };
}

export function startDncRecheckCron(): void {
  // 02:30 every day — outside the SEO (03:00) and CMS (Sun 04:00) windows.
  registerCron({
    name: "dnc-recheck",
    schedule: "30 2 * * *",
    fn: async () => { await runDncRecheck(); },
  });
}
