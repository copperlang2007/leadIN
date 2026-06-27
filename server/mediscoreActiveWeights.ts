// Holds the currently-active calibrated MediScore weights in process memory.
//
// Kept in its own dependency-free module so both the scorer (mediscore.ts) and
// the calibration job (mediscoreCalibrationJob.ts) can use it without creating
// an import cycle. The calibration cron sets these on the leader instance;
// when unset, the scorer falls back to the static base weights.
//
// NOTE: this is per-instance, in-memory state. Durable, cross-instance
// persistence (a weights table read at boot) is a documented follow-up.

let active: Record<string, number> | undefined;
let updatedAt: string | undefined;

export function setActiveCalibratedWeights(weights: Record<string, number>): void {
  active = weights;
  updatedAt = new Date().toISOString();
}

export function getActiveCalibratedWeights(): Record<string, number> | undefined {
  return active;
}

export function getActiveCalibratedWeightsMeta(): { updatedAt: string | undefined; count: number } {
  return { updatedAt, count: active ? Object.keys(active).length : 0 };
}

/** Test/ops helper to clear the in-memory weights. */
export function clearActiveCalibratedWeights(): void {
  active = undefined;
  updatedAt = undefined;
}
