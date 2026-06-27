// MediScore adaptive calibration — the "always-optimizing" learning loop.
//
// The static MediScore weights (mediscore.ts SIGNAL_DEFS) encode a human prior
// about what makes a lead good. This module closes the loop: it observes which
// signals actually preceded conversions and nudges each signal's weight up or
// down accordingly — without sacrificing the explainable, auditable structure
// that buyers trust.
//
// Method (deliberately simple, robust, and inspectable rather than a black box):
//   1. Estimate the base conversion rate p0 from all scored leads, with a weak
//      Beta prior so a cold start doesn't divide by zero.
//   2. For each signal, estimate the conversion rate among leads where the
//      signal fired, shrunk toward p0 (Bayesian smoothing) so sparse signals
//      don't swing wildly.
//   3. Convert the lift to a log-odds delta and map it to a bounded multiplier
//      (MIN_MULTIPLIER..MAX_MULTIPLIER). Below MIN_SAMPLES observations the
//      multiplier is pinned to 1.0 — we don't trust data we don't have.
//   4. calibratedWeight = round(baseWeight × multiplier).
//
// The result is a per-signal weight map consumable by `scoreFromInputs(i, map)`
// plus a full audit trail of how each weight was derived. Everything here is a
// pure function so it is unit-testable without a database; a thin DB loader is
// provided separately for the periodic recompute job.

import { BASE_WEIGHTS } from "./mediscore";

/** Observed outcomes for a single signal key over a training window. */
export interface SignalOutcomeStat {
  key: string;
  /** Leads scored in the window where this signal fired. */
  leadsWithSignal: number;
  /** Of those, how many converted (e.g. enrolled / sold / qualified). */
  conversionsWithSignal: number;
}

export interface CalibrationInput {
  /** Total scored leads in the training window. */
  totalLeads: number;
  /** Total conversions in the training window. */
  totalConversions: number;
  perSignal: SignalOutcomeStat[];
  /**
   * Shrinkage strength (pseudo-observations pulling each signal's rate toward
   * the base rate). Larger = more conservative. Default 50.
   */
  priorStrength?: number;
  /**
   * Minimum observations of a signal before its learned multiplier is trusted.
   * Below this the multiplier is 1.0 (use the human prior). Default 30.
   */
  minSamples?: number;
  /** Sensitivity of the multiplier to log-odds lift. Default 0.6. */
  sensitivity?: number;
}

export interface CalibratedSignal {
  key: string;
  baseWeight: number;
  calibratedWeight: number;
  multiplier: number;
  observedRate: number; // smoothed conversion rate when signal fires
  baseRate: number; // population base rate
  logOddsLift: number; // ln(odds(observed)/odds(base))
  sampleSize: number;
  trusted: boolean; // false => not enough data, multiplier pinned to 1
}

export interface CalibrationResult {
  baseRate: number;
  totalLeads: number;
  totalConversions: number;
  signals: CalibratedSignal[];
  /** Map of signal key -> calibrated weight, ready for scoreFromInputs(). */
  weights: Record<string, number>;
  computedAt: string;
}

// Multiplier bounds: a learned weight can shrink to a quarter or triple, never
// invert (a positive signal can't become negative) and never run away.
const MIN_MULTIPLIER = 0.25;
const MAX_MULTIPLIER = 3.0;

// Weak Beta(α, β) prior for the population base rate so a cold start is sane
// (defaults to ~3% assumed conversion until data says otherwise).
const BASE_PRIOR_ALPHA = 3;
const BASE_PRIOR_BETA = 97;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function odds(p: number): number {
  const eps = 1e-6;
  const q = clamp(p, eps, 1 - eps);
  return q / (1 - q);
}

/**
 * Pure calibration. Given the static base weights and observed outcomes,
 * returns learned weights + a full derivation audit trail.
 */
export function calibrateWeights(
  input: CalibrationInput,
  baseWeights: Record<string, number> = BASE_WEIGHTS,
): CalibrationResult {
  const priorStrength = input.priorStrength ?? 50;
  const minSamples = input.minSamples ?? 30;
  const sensitivity = input.sensitivity ?? 0.6;

  // Base rate with a weak Beta prior.
  const baseRate =
    (input.totalConversions + BASE_PRIOR_ALPHA) /
    (input.totalLeads + BASE_PRIOR_ALPHA + BASE_PRIOR_BETA);

  const statByKey = new Map(input.perSignal.map(s => [s.key, s]));

  const signals: CalibratedSignal[] = Object.keys(baseWeights).map(key => {
    const baseWeight = baseWeights[key];
    const stat = statByKey.get(key);
    const n = stat?.leadsWithSignal ?? 0;
    const c = stat?.conversionsWithSignal ?? 0;

    // Shrink the signal's conversion rate toward the base rate. With zero
    // observations this collapses to baseRate (lift 0, multiplier 1).
    const observedRate = (c + baseRate * priorStrength) / (n + priorStrength);
    const logOddsLift = Math.log(odds(observedRate) / odds(baseRate));

    const trusted = n >= minSamples;
    const multiplier = trusted
      ? clamp(Math.exp(sensitivity * logOddsLift), MIN_MULTIPLIER, MAX_MULTIPLIER)
      : 1.0;

    return {
      key,
      baseWeight,
      calibratedWeight: Math.max(0, Math.round(baseWeight * multiplier)),
      multiplier: Number(multiplier.toFixed(4)),
      observedRate: Number(observedRate.toFixed(6)),
      baseRate: Number(baseRate.toFixed(6)),
      logOddsLift: Number(logOddsLift.toFixed(6)),
      sampleSize: n,
      trusted,
    };
  });

  const weights: Record<string, number> = Object.fromEntries(
    signals.map(s => [s.key, s.calibratedWeight]),
  );

  return {
    baseRate: Number(baseRate.toFixed(6)),
    totalLeads: input.totalLeads,
    totalConversions: input.totalConversions,
    signals,
    weights,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Blend learned weights toward the base weights by `learningRate` (0..1) to
 * damp period-over-period swings. learningRate=0 => no change from base;
 * learningRate=1 => fully adopt the learned weights. Used by the recompute job
 * so weights drift smoothly rather than lurching each cycle.
 */
export function blendWeights(
  base: Record<string, number>,
  learned: Record<string, number>,
  learningRate: number,
): Record<string, number> {
  const lr = clamp(learningRate, 0, 1);
  const out: Record<string, number> = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const l = learned[key] ?? b;
    out[key] = Math.max(0, Math.round(b + (l - b) * lr));
  }
  return out;
}
