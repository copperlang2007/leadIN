import { describe, it, expect } from "vitest";
import { calibrateWeights, blendWeights } from "./mediscoreCalibration";
import { BASE_WEIGHTS, scoreFromInputs, type MediScoreInputs } from "./mediscore";

const baseInputs: MediScoreInputs = {
  verified: true,
  hasTcpa: true,
  exclusivity: "Exclusive",
  ageHours: 1,
  phonePresent: true,
  emailPresent: true,
  addressPresent: true,
  consumerAge: 70,
  homeowner: true,
  income: "$50k+",
  smoker: false,
  hasCondition: false,
  source: "Organic Search",
  dncFlagged: false,
  cmsTermination: true,
  cmsBenefitChange: true,
  cmsStarDrop: true,
  maxDwellSeconds: 120,
  maxScrollPercent: 90,
  ctaClicks: 2,
  toolInteractions: 1,
  seoCategoryMatch: true,
};

describe("calibrateWeights", () => {
  it("cold start with no outcomes leaves weights at the human prior", () => {
    const r = calibrateWeights({ totalLeads: 0, totalConversions: 0, perSignal: [] });
    expect(r.weights).toEqual(BASE_WEIGHTS);
    for (const s of r.signals) {
      expect(s.multiplier).toBe(1);
      expect(s.trusted).toBe(false);
    }
  });

  it("raises the weight of a signal that strongly predicts conversion", () => {
    // base rate ~3%; this signal converts at 40% over 200 leads
    const r = calibrateWeights({
      totalLeads: 5000,
      totalConversions: 150,
      perSignal: [{ key: "behavior_cta", leadsWithSignal: 200, conversionsWithSignal: 80 }],
      minSamples: 30,
    });
    const cta = r.signals.find(s => s.key === "behavior_cta")!;
    expect(cta.trusted).toBe(true);
    expect(cta.multiplier).toBeGreaterThan(1);
    expect(cta.calibratedWeight).toBeGreaterThan(cta.baseWeight);
    expect(cta.logOddsLift).toBeGreaterThan(0);
  });

  it("lowers the weight of a signal that under-performs the base rate", () => {
    const r = calibrateWeights({
      totalLeads: 5000,
      totalConversions: 500, // 10% base
      perSignal: [{ key: "homeowner", leadsWithSignal: 400, conversionsWithSignal: 4 }], // 1%
      minSamples: 30,
    });
    const ho = r.signals.find(s => s.key === "homeowner")!;
    expect(ho.trusted).toBe(true);
    expect(ho.multiplier).toBeLessThan(1);
    expect(ho.calibratedWeight).toBeLessThan(ho.baseWeight);
  });

  it("does not trust a signal below the minimum sample size", () => {
    const r = calibrateWeights({
      totalLeads: 5000,
      totalConversions: 150,
      perSignal: [{ key: "behavior_cta", leadsWithSignal: 5, conversionsWithSignal: 5 }],
      minSamples: 30,
    });
    const cta = r.signals.find(s => s.key === "behavior_cta")!;
    expect(cta.trusted).toBe(false);
    expect(cta.multiplier).toBe(1);
    expect(cta.calibratedWeight).toBe(cta.baseWeight);
  });

  it("keeps multipliers within bounds even for extreme outcomes", () => {
    const r = calibrateWeights({
      totalLeads: 100000,
      totalConversions: 100, // ~0.1% base
      perSignal: [{ key: "dnc_clean", leadsWithSignal: 1000, conversionsWithSignal: 990 }], // 99%
      minSamples: 30,
    });
    const dnc = r.signals.find(s => s.key === "dnc_clean")!;
    expect(dnc.multiplier).toBeLessThanOrEqual(3.0);
    expect(dnc.calibratedWeight).toBeGreaterThanOrEqual(0);
  });

  it("never produces a negative weight", () => {
    const r = calibrateWeights({
      totalLeads: 5000,
      totalConversions: 2500,
      perSignal: BASE_WEIGHTS
        ? Object.keys(BASE_WEIGHTS).map(key => ({ key, leadsWithSignal: 500, conversionsWithSignal: 0 }))
        : [],
      minSamples: 30,
    });
    for (const s of r.signals) expect(s.calibratedWeight).toBeGreaterThanOrEqual(0);
  });
});

describe("blendWeights", () => {
  it("learningRate 0 returns the base weights", () => {
    const learned = { ...BASE_WEIGHTS, dnc_clean: 30 };
    expect(blendWeights(BASE_WEIGHTS, learned, 0)).toEqual(BASE_WEIGHTS);
  });

  it("learningRate 1 fully adopts learned weights", () => {
    const learned = { ...BASE_WEIGHTS, dnc_clean: 30 };
    expect(blendWeights(BASE_WEIGHTS, learned, 1).dnc_clean).toBe(30);
  });

  it("learningRate 0.5 lands halfway and rounds", () => {
    const learned = { ...BASE_WEIGHTS, dnc_clean: 30 }; // base 10 -> 20
    expect(blendWeights(BASE_WEIGHTS, learned, 0.5).dnc_clean).toBe(20);
  });
});

describe("scoreFromInputs with calibrated weight overrides", () => {
  it("matches the static score when no overrides given", () => {
    const a = scoreFromInputs(baseInputs);
    const b = scoreFromInputs(baseInputs, undefined);
    expect(a.score).toBe(b.score);
  });

  it("stays within 0..100 with calibrated overrides", () => {
    const { weights } = calibrateWeights({
      totalLeads: 5000,
      totalConversions: 150,
      perSignal: [{ key: "behavior_cta", leadsWithSignal: 200, conversionsWithSignal: 120 }],
      minSamples: 30,
    });
    const out = scoreFromInputs(baseInputs, weights);
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
  });

  it("falls back to base weight for any unspecified or invalid override", () => {
    const partial = { behavior_cta: 50 }; // only one key, rest fall back
    const out = scoreFromInputs(baseInputs, partial);
    const cta = out.signals.find(s => s.key === "behavior_cta")!;
    const verified = out.signals.find(s => s.key === "verified")!;
    expect(cta.weight).toBe(50);
    expect(verified.weight).toBe(BASE_WEIGHTS.verified);
  });
});
