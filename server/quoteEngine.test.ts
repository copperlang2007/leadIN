import { describe, it, expect } from "vitest";
import { evaluateQuote, type QuoteInput } from "./quoteEngine";

// Fixed reference dates for deterministic window tests.
const inAepDate = new Date("2026-11-01T12:00:00Z");
const offSeasonDate = new Date("2026-07-01T12:00:00Z");

function q(over: Partial<QuoteInput> = {}): QuoteInput {
  return { state: "TX", ...over };
}

describe("evaluateQuote — eligibility", () => {
  it("eligible at 65+", () => {
    const r = evaluateQuote(q({ age: 70 }), offSeasonDate);
    expect(r.eligible).toBe(true);
    expect(r.reasons).toContain("age_65_plus");
  });

  it("eligible when turning 65 within 3 months (IEP)", () => {
    // dob ~64y9m before reference => 65th birthday ~3 months out
    const dob = "1961-09-15"; // turns 65 on 2026-09-15, ~2.5 months after 2026-07-01
    const r = evaluateQuote(q({ dob }), offSeasonDate);
    expect(r.eligible).toBe(true);
    expect(r.enrollmentWindows.some(w => w.startsWith("IEP"))).toBe(true);
  });

  it("not eligible at 50 with no other trigger", () => {
    const r = evaluateQuote(q({ age: 50 }), offSeasonDate);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("not_yet_eligible");
    expect(r.recommendedPlanTypes).toEqual([]);
  });

  it("eligible if already on Medicare regardless of age field", () => {
    const r = evaluateQuote(q({ currentlyOnMedicare: true }), offSeasonDate);
    expect(r.eligible).toBe(true);
    expect(r.reasons).toContain("currently_enrolled");
  });
});

describe("evaluateQuote — plan recommendations", () => {
  it("offers MA, Medigap, PDP by default for an eligible consumer", () => {
    const r = evaluateQuote(q({ age: 67 }), offSeasonDate);
    expect(r.recommendedPlanTypes).toEqual(
      expect.arrayContaining(["Medicare Advantage", "Medigap", "Part D (PDP)"]),
    );
  });

  it("recommends D-SNP for low-income (dual-eligible) consumers", () => {
    const r = evaluateQuote(q({ age: 67, lowIncome: true }), offSeasonDate);
    expect(r.recommendedPlanTypes).toContain("D-SNP");
  });

  it("recommends C-SNP for chronic conditions", () => {
    const r = evaluateQuote(q({ age: 67, chronicConditions: true }), offSeasonDate);
    expect(r.recommendedPlanTypes).toContain("C-SNP");
  });

  it("honors an explicit interest", () => {
    const r = evaluateQuote(q({ age: 67, interest: "Medigap" }), offSeasonDate);
    expect(r.recommendedPlanTypes).toContain("Medigap");
  });
});

describe("evaluateQuote — enrollment windows", () => {
  it("flags AEP during Oct 15 – Dec 7", () => {
    const r = evaluateQuote(q({ age: 70 }), inAepDate);
    expect(r.enrollmentWindows.some(w => w.startsWith("AEP"))).toBe(true);
  });

  it("does not flag AEP off-season", () => {
    const r = evaluateQuote(q({ age: 70 }), offSeasonDate);
    expect(r.enrollmentWindows.some(w => w.startsWith("AEP"))).toBe(false);
  });

  it("flags OEP only for those already enrolled", () => {
    const jan = new Date("2026-01-15T12:00:00Z");
    expect(evaluateQuote(q({ age: 70, currentlyOnMedicare: true }), jan).enrollmentWindows.some(w => w.startsWith("OEP"))).toBe(true);
    expect(evaluateQuote(q({ age: 70 }), jan).enrollmentWindows.some(w => w.startsWith("OEP"))).toBe(false);
  });

  it("adds SEP windows for move / loss of coverage", () => {
    const r = evaluateQuote(q({ age: 70, movedRecently: true, lostCoverage: true }), offSeasonDate);
    expect(r.enrollmentWindows.some(w => w.includes("recent move"))).toBe(true);
    expect(r.enrollmentWindows.some(w => w.includes("loss of coverage"))).toBe(true);
  });
});

describe("evaluateQuote — intent", () => {
  it("scores a hot lead (eligible + open window + interest) high", () => {
    const r = evaluateQuote(q({ age: 70, interest: "Medicare Advantage" }), inAepDate);
    expect(r.estimatedIntent).toBeGreaterThanOrEqual(70);
  });

  it("scores an ineligible off-season visitor low", () => {
    const r = evaluateQuote(q({ age: 40 }), offSeasonDate);
    expect(r.estimatedIntent).toBeLessThanOrEqual(20);
  });

  it("never exceeds 100", () => {
    const r = evaluateQuote(
      q({ age: 70, dob: "1961-05-01", interest: "Medicare Advantage", movedRecently: true, lostCoverage: true }),
      inAepDate,
    );
    expect(r.estimatedIntent).toBeLessThanOrEqual(100);
  });
});
