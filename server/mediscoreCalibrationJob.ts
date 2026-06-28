// MediScore calibration job — the recurring half of the learning loop.
//
// Periodically reads purchased leads + their conversion outcomes, derives
// per-signal conversion statistics, learns calibrated weights (phase-1
// mediscoreCalibration engine), damps the change toward the current weights,
// and installs the result as the active scoring weights. This is what makes the
// "always-optimizing" promise real: signals that actually precede conversions
// earn more weight over time.
//
// The pure `computeCalibrationFromOutcomes` is unit-testable without a DB; the
// DB-bound `runMediscoreCalibration` wires it to real data and the cron.

import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { orders, leads } from "@shared/schema";
import { BASE_WEIGHTS } from "./mediscore";
import {
  calibrateWeights,
  blendWeights,
  type CalibrationResult,
  type SignalOutcomeStat,
} from "./mediscoreCalibration";
import { setActiveCalibratedWeights } from "./mediscoreActiveWeights";
import { registerCron } from "./lib/cronRegistry";
import { storage } from "./storage";

export interface OutcomeRow {
  /** The persisted MediScore breakdown's signal hits for this lead. */
  signals: Array<{ key: string; hit: boolean }>;
  /** Did this purchased lead convert (enroll/close)? */
  converted: boolean;
}

export interface CalibrationJobResult {
  calibration: CalibrationResult;
  /** Final weights after blending learned toward base (what gets installed). */
  weights: Record<string, number>;
  sampleSize: number;
  conversions: number;
}

/**
 * Aggregate outcome rows into per-signal stats and learn + blend weights.
 * Pure & deterministic. `learningRate` damps movement toward learned weights.
 */
export function computeCalibrationFromOutcomes(
  rows: OutcomeRow[],
  opts: { learningRate?: number; minSamples?: number; baseWeights?: Record<string, number> } = {},
): CalibrationJobResult {
  const baseWeights = opts.baseWeights ?? BASE_WEIGHTS;
  const learningRate = opts.learningRate ?? 0.5;

  const totalLeads = rows.length;
  const totalConversions = rows.filter(r => r.converted).length;

  // Tally leadsWithSignal / conversionsWithSignal per signal key.
  const tally = new Map<string, { leads: number; conv: number }>();
  for (const key of Object.keys(baseWeights)) tally.set(key, { leads: 0, conv: 0 });
  for (const row of rows) {
    for (const s of row.signals) {
      if (!s.hit) continue;
      const t = tally.get(s.key);
      if (!t) continue; // ignore unknown/legacy signal keys
      t.leads += 1;
      if (row.converted) t.conv += 1;
    }
  }
  const perSignal: SignalOutcomeStat[] = Array.from(tally.entries()).map(([key, t]) => ({
    key,
    leadsWithSignal: t.leads,
    conversionsWithSignal: t.conv,
  }));

  const calibration = calibrateWeights(
    { totalLeads, totalConversions, perSignal, minSamples: opts.minSamples },
    baseWeights,
  );
  const weights = blendWeights(baseWeights, calibration.weights, learningRate);

  return { calibration, weights, sampleSize: totalLeads, conversions: totalConversions };
}

const MAX_TRAINING_ROWS = 20_000;

/**
 * Read purchased leads + outcomes from the DB, learn weights, and install them
 * as the active scoring weights. Returns null when there isn't enough data.
 */
export async function runMediscoreCalibration(): Promise<CalibrationJobResult | null> {
  // Each purchased lead is a labeled example: its stored MediScore signal hits
  // (features) + whether the order converted (label).
  const purchased = await db
    .select({ signals: leads.mediscoreSignals, status: orders.status })
    .from(orders)
    .leftJoin(leads, eq(orders.leadId, leads.id))
    .where(sql`${leads.mediscoreSignals} IS NOT NULL`)
    .limit(MAX_TRAINING_ROWS);

  const rows: OutcomeRow[] = purchased
    .map(r => {
      const breakdown = r.signals as any;
      const signals = Array.isArray(breakdown?.signals)
        ? breakdown.signals.map((s: any) => ({ key: String(s.key), hit: !!s.hit }))
        : [];
      return { signals, converted: r.status === "converted" };
    })
    .filter(r => r.signals.length > 0);

  // Don't move weights off too little data.
  if (rows.length < 50) {
    console.log(`[mediscore-calibration] only ${rows.length} labeled leads — skipping (need >= 50).`);
    return null;
  }

  const result = computeCalibrationFromOutcomes(rows);
  setActiveCalibratedWeights(result.weights);

  // Persist durably so the learned weights survive restarts and are shared
  // across instances (best-effort; the in-memory holder is already updated).
  await storage
    .saveMediscoreWeights({
      weights: result.weights,
      sampleSize: result.sampleSize,
      conversions: result.conversions,
      baseRate: String(result.calibration.baseRate),
    })
    .catch(err => console.error("[mediscore-calibration] persist error:", err?.message));

  console.log(
    `[mediscore-calibration] trained on ${result.sampleSize} leads (${result.conversions} conversions); ` +
      `installed + persisted calibrated weights.`,
  );
  return result;
}

/**
 * Load the most recent persisted calibrated weights into the active holder.
 * Called at boot so learned weights survive restarts. No-op (and silent) when
 * nothing has been persisted yet — scoring falls back to base weights.
 */
export async function loadPersistedCalibration(): Promise<boolean> {
  try {
    const row = await storage.getLatestMediscoreWeights();
    if (row && row.weights && typeof row.weights === "object") {
      setActiveCalibratedWeights(row.weights as Record<string, number>);
      console.log(`[mediscore-calibration] loaded persisted weights from ${row.createdAt?.toISOString?.() ?? "db"}.`);
      return true;
    }
  } catch (err: any) {
    console.error("[mediscore-calibration] load error:", err?.message);
  }
  return false;
}

export function startMediscoreCalibrationCron(): void {
  // Weekly, Monday 05:00 — after the CMS (Sun 04:00) refresh so star/benefit
  // signals are current.
  registerCron({
    name: "mediscore-calibration",
    schedule: "0 5 * * 1",
    fn: async () => {
      await runMediscoreCalibration();
    },
  });
}
