import { describe, it, expect } from "vitest";
import { scoreFromInputs, type MediScoreInputs } from "./mediscore";

// Pure scorer tests. No DB. Each test toggles one signal class so weight
// regressions are caught immediately.

const base: MediScoreInputs = {
  verified: false,
  hasTcpa: false,
  exclusivity: "Shared (2)",
  ageHours: 100,
  phonePresent: false,
  emailPresent: false,
  addressPresent: false,
  consumerAge: 30,
  homeowner: null,
  income: null,
  smoker: null,
  hasCondition: null,
  source: "Facebook",
  dncFlagged: true,
  cmsTermination: false,
  cmsBenefitChange: false,
  cmsStarDrop: false,
  maxDwellSeconds: 0,
  maxScrollPercent: 0,
  ctaClicks: 0,
  toolInteractions: 0,
  seoCategoryMatch: false,
};

describe("scoreFromInputs", () => {
  it("returns 0 active signals on the empty/cold lead", () => {
    const r = scoreFromInputs(base);
    expect(r.activeSignalCount).toBe(0);
    expect(r.score).toBe(0);
  });

  it("verified + tcpa + exclusive lifts the score", () => {
    const r = scoreFromInputs({ ...base, verified: true, hasTcpa: true, exclusivity: "Exclusive", dncFlagged: false });
    expect(r.activeSignalCount).toBeGreaterThanOrEqual(4);
    expect(r.score).toBeGreaterThan(20);
  });

  it("DNC-clean is a heavyweight signal", () => {
    const flagged = scoreFromInputs(base);
    const clean = scoreFromInputs({ ...base, dncFlagged: false });
    expect(clean.score).toBeGreaterThan(flagged.score);
    // dnc_clean weight is 10 out of denominator 104 → ~10 points
    expect(clean.score - flagged.score).toBeGreaterThanOrEqual(9);
  });

  it("age-in-window only fires between 60 and 80", () => {
    expect(scoreFromInputs({ ...base, consumerAge: 59 }).signals.find(s => s.key === "age_in_window")!.hit).toBe(false);
    expect(scoreFromInputs({ ...base, consumerAge: 60 }).signals.find(s => s.key === "age_in_window")!.hit).toBe(true);
    expect(scoreFromInputs({ ...base, consumerAge: 80 }).signals.find(s => s.key === "age_in_window")!.hit).toBe(true);
    expect(scoreFromInputs({ ...base, consumerAge: 81 }).signals.find(s => s.key === "age_in_window")!.hit).toBe(false);
  });

  it("premium source fires only on call-center transfers and organic search", () => {
    expect(scoreFromInputs({ ...base, source: "Call Center Transfer" }).signals.find(s => s.key === "premium_source")!.hit).toBe(true);
    expect(scoreFromInputs({ ...base, source: "Organic Search" }).signals.find(s => s.key === "premium_source")!.hit).toBe(true);
    expect(scoreFromInputs({ ...base, source: "Facebook" }).signals.find(s => s.key === "premium_source")!.hit).toBe(false);
  });

  it("behavioral signals fire on the threshold values", () => {
    const r = scoreFromInputs({ ...base, maxDwellSeconds: 60, maxScrollPercent: 75, ctaClicks: 1, toolInteractions: 1 });
    expect(r.signals.find(s => s.key === "behavior_dwell")!.hit).toBe(true);
    expect(r.signals.find(s => s.key === "behavior_scroll")!.hit).toBe(true);
    expect(r.signals.find(s => s.key === "behavior_cta")!.hit).toBe(true);
    expect(r.signals.find(s => s.key === "behavior_tool")!.hit).toBe(true);
  });

  it("CMS star drop only fires when starRating < 3.5 — caller passes the boolean", () => {
    const r = scoreFromInputs({ ...base, cmsStarDrop: true });
    expect(r.signals.find(s => s.key === "cms_star_drop")!.hit).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it("a fully-loaded perfect lead caps at 100", () => {
    const perfect: MediScoreInputs = {
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
      source: "Call Center Transfer",
      dncFlagged: false,
      cmsTermination: true,
      cmsBenefitChange: true,
      cmsStarDrop: true,
      maxDwellSeconds: 200,
      maxScrollPercent: 100,
      ctaClicks: 5,
      toolInteractions: 3,
      seoCategoryMatch: true,
    };
    const r = scoreFromInputs(perfect);
    expect(r.score).toBe(100);
    expect(r.activeSignalCount).toBe(22);
  });

  it("preserves the signal definitions in stable order", () => {
    const r = scoreFromInputs(base);
    expect(r.signals.map(s => s.key)).toEqual([
      "verified", "tcpa_consent", "exclusive", "fresh_lead",
      "phone_present", "email_present", "address_present", "age_in_window",
      "homeowner", "income_qualified", "non_smoker", "no_condition",
      "premium_source", "dnc_clean", "cms_termination", "cms_benefit_change",
      "cms_star_drop", "behavior_dwell", "behavior_scroll", "behavior_cta",
      "behavior_tool", "seo_demand",
    ]);
  });
});
