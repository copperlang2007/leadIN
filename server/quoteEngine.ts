// Quote-tool eligibility + plan-match engine — the top-of-funnel lead magnet.
//
// A consumer answers a few questions ("find your plan in 60 seconds") and gets
// an instant, useful result: are they eligible, which Medicare plan types fit,
// and which enrollment window is open. That value-first interaction is what
// converts anonymous traffic into a consented lead (far better than a bare
// contact form). This module is the pure brain; the capture/persistence lives
// in the route so this stays fully unit-testable.

export type PlanType = "Medicare Advantage" | "Medigap" | "Part D (PDP)" | "D-SNP" | "C-SNP";

export interface QuoteInput {
  /** Either age or dob should be provided. */
  age?: number;
  /** ISO date (YYYY-MM-DD). */
  dob?: string;
  state: string;
  zip?: string;
  currentlyOnMedicare?: boolean;
  interest?: PlanType;
  lowIncome?: boolean; // dual-eligible signal
  chronicConditions?: boolean; // C-SNP signal
  movedRecently?: boolean; // SEP trigger
  lostCoverage?: boolean; // SEP trigger
}

export interface QuoteResult {
  eligible: boolean;
  reasons: string[];
  recommendedPlanTypes: PlanType[];
  enrollmentWindows: string[]; // currently-open windows for this consumer
  /** 0..100 estimated purchase intent, feeds MediScore/pricing if captured. */
  estimatedIntent: number;
}

function ageFromDob(dob: string, now: Date): number | null {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/** Months until the consumer's 65th birthday (negative if already past). */
function monthsTo65(dob: string, now: Date): number | null {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const sixtyFifth = new Date(Date.UTC(d.getUTCFullYear() + 65, d.getUTCMonth(), d.getUTCDate()));
  return (sixtyFifth.getUTCFullYear() - now.getUTCFullYear()) * 12 + (sixtyFifth.getUTCMonth() - now.getUTCMonth());
}

function inAep(now: Date): boolean {
  const m = now.getUTCMonth(); // 0-indexed
  const day = now.getUTCDate();
  // Oct 15 – Dec 7
  if (m === 9 && day >= 15) return true; // October
  if (m === 10) return true; // November
  if (m === 11 && day <= 7) return true; // December
  return false;
}

function inOep(now: Date): boolean {
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  // Jan 1 – Mar 31
  if (m === 0 || m === 1) return true;
  if (m === 2 && day <= 31) return true;
  return false;
}

/**
 * Evaluate a quote. Pure & deterministic given `now`.
 */
export function evaluateQuote(input: QuoteInput, now: Date = new Date()): QuoteResult {
  const reasons: string[] = [];
  const age = input.age ?? (input.dob ? ageFromDob(input.dob, now) ?? undefined : undefined);
  const months65 = input.dob ? monthsTo65(input.dob, now) : null;

  // Eligibility: 65+, within the IEP window around the 65th birthday, or
  // already enrolled (so they can switch/add coverage).
  const turning65Soon = months65 !== null && months65 <= 3 && months65 >= -3;
  const eligible = (age !== undefined && age >= 65) || turning65Soon || !!input.currentlyOnMedicare;

  if (age !== undefined && age >= 65) reasons.push("age_65_plus");
  if (turning65Soon) reasons.push("initial_enrollment_window");
  if (input.currentlyOnMedicare) reasons.push("currently_enrolled");
  if (!eligible) reasons.push("not_yet_eligible");

  // Plan recommendations.
  const plans = new Set<PlanType>();
  if (input.interest) plans.add(input.interest);
  if (eligible) {
    if (input.lowIncome) plans.add("D-SNP");
    if (input.chronicConditions) plans.add("C-SNP");
    if (plans.size === 0) {
      plans.add("Medicare Advantage");
      plans.add("Medigap");
      plans.add("Part D (PDP)");
    } else {
      // Always offer PDP alongside special-needs plans unless MA chosen.
      if (!plans.has("Medicare Advantage")) plans.add("Part D (PDP)");
    }
  }

  // Open enrollment windows.
  const windows: string[] = [];
  if (turning65Soon) windows.push("IEP (Initial Enrollment Period)");
  if (inAep(now)) windows.push("AEP (Oct 15 – Dec 7)");
  if (inOep(now) && input.currentlyOnMedicare) windows.push("OEP (Jan 1 – Mar 31)");
  if (input.movedRecently) windows.push("SEP (recent move)");
  if (input.lostCoverage) windows.push("SEP (loss of coverage)");

  // Intent heuristic: an open window + clear interest + eligibility => hot.
  let intent = 0;
  if (eligible) intent += 30;
  if (windows.length > 0) intent += 30;
  if (input.interest) intent += 15;
  if (turning65Soon) intent += 15;
  if (input.movedRecently || input.lostCoverage) intent += 10;
  intent = Math.min(100, intent);

  return {
    eligible,
    reasons,
    recommendedPlanTypes: Array.from(plans),
    enrollmentWindows: windows,
    estimatedIntent: intent,
  };
}
