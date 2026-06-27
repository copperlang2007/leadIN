import { describe, it, expect } from "vitest";
import { computeCalibrationFromOutcomes, type OutcomeRow } from "./mediscoreCalibrationJob";
import { BASE_WEIGHTS } from "./mediscore";

// Build N rows where `signalKey` fires, with `convRate` of them converted.
function rowsWith(signalKey: string, n: number, convRate: number): OutcomeRow[] {
  const out: OutcomeRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ signals: [{ key: signalKey, hit: true }], converted: i / n < convRate });
  }
  return out;
}

describe("computeCalibrationFromOutcomes", () => {
  it("returns sample/conversion counts", () => {
    const rows = rowsWith("behavior_cta", 100, 0.3);
    const r = computeCalibrationFromOutcomes(rows);
    expect(r.sampleSize).toBe(100);
    expect(r.conversions).toBe(30);
  });

  it("raises weight for a strongly-converting signal (blended)", () => {
    // 300 leads: 200 with cta converting at 50%, 100 without converting at 2%
    const rows: OutcomeRow[] = [
      ...rowsWith("behavior_cta", 200, 0.5),
      ...Array.from({ length: 100 }, (_, i) => ({
        signals: [{ key: "homeowner", hit: true }],
        converted: i < 2,
      })),
    ];
    const r = computeCalibrationFromOutcomes(rows, { learningRate: 1 });
    expect(r.weights.behavior_cta).toBeGreaterThan(BASE_WEIGHTS.behavior_cta);
  });

  it("learningRate 0 leaves weights at base (pure damping check)", () => {
    const rows = rowsWith("behavior_cta", 500, 0.9);
    const r = computeCalibrationFromOutcomes(rows, { learningRate: 0 });
    expect(r.weights).toEqual(BASE_WEIGHTS);
  });

  it("ignores unknown/legacy signal keys without throwing", () => {
    const rows: OutcomeRow[] = [
      { signals: [{ key: "totally_made_up_signal", hit: true }], converted: true },
      { signals: [{ key: "behavior_cta", hit: true }], converted: true },
    ];
    const r = computeCalibrationFromOutcomes(rows);
    expect(r.weights).not.toHaveProperty("totally_made_up_signal");
    expect(Object.keys(r.weights).sort()).toEqual(Object.keys(BASE_WEIGHTS).sort());
  });

  it("handles all-zero conversions without producing negative weights", () => {
    const rows = rowsWith("behavior_cta", 200, 0);
    const r = computeCalibrationFromOutcomes(rows, { learningRate: 1 });
    for (const k of Object.keys(r.weights)) expect(r.weights[k]).toBeGreaterThanOrEqual(0);
  });

  it("emits a full calibration audit trail", () => {
    const rows = rowsWith("behavior_cta", 100, 0.4);
    const r = computeCalibrationFromOutcomes(rows);
    expect(r.calibration.signals.length).toBe(Object.keys(BASE_WEIGHTS).length);
    expect(r.calibration.baseRate).toBeGreaterThan(0);
  });
});
