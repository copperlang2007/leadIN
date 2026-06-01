// Nightly re-check: every unsold lead older than 24h gets its phone re-run
// against the DNC list. Phones can be added to the DNC registry after a
// lead is ingested; this keeps the marketplace honest.

import { db } from "./db";
import { leads } from "@shared/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { checkDnc } from "./dncCompliance";
import { recomputeAndPersistMediScore } from "./mediscore";
import { registerCron } from "./lib/cronRegistry";

const RECHECK_AGE_HOURS = 24;
const BATCH_LIMIT = 500;

export async function runDncRecheck(): Promise<{ scanned: number; flipped: number }> {
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
  for (const lead of stale) {
    if (!lead.consumerPhone) continue;
    const result = await checkDnc(lead.consumerPhone);
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
    console.log(`[dnc-recheck] scanned ${stale.length} leads, flipped ${flipped}`);
  }
  return { scanned: stale.length, flipped };
}

export function startDncRecheckCron(): void {
  // 02:30 every day — outside the SEO (03:00) and CMS (Sun 04:00) windows.
  registerCron({
    name: "dnc-recheck",
    schedule: "30 2 * * *",
    fn: async () => { await runDncRecheck(); },
  });
}
