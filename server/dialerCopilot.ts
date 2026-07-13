// AI Dialer Copilot — scoped first slice (request/response only, NO real-time
// audio / Twilio media streams).
//
// This module powers `POST /api/dialer/copilot`. For a purchased lead plus a
// transcript snippet it produces two things an agent on a live call needs:
//
//   1. A structured, PURE compliance object + human-readable `warnings[]`
//      (`buildCompliance`) — calling hours, DNC, two-party-consent recording,
//      and TCPA verification. This is deterministic and unit-tested.
//   2. Up to 3 AI-suggested next-best talking points (`generateSuggestions`),
//      routed through the shared `lib/llm.chat` abstraction which falls back to
//      a DETERMINISTIC STUB when neither OPENAI_API_KEY nor ANTHROPIC_API_KEY
//      is set (the CI/test default), so tests pass offline.
//
// The calling-hours check REUSES the platform's DST-aware, per-state
// `isWithinCallingHours` helper (server/callingHours.ts, behind
// /api/compliance/calling-hours) rather than reimplementing a naive window.

import { isWithinCallingHours } from "./callingHours";
import { chat } from "./lib/llm";

// ──────────────────────────────────────────────────────────────────
// Two-party (all-party) consent states
// ──────────────────────────────────────────────────────────────────
//
// States whose wiretap statutes require the consent of ALL parties to record
// a phone call (as opposed to one-party-consent states, where only the
// recorder need consent). This is the commonly-cited ~12-state list used by
// call centers. Statutory nuance exists (some states distinguish in-person vs.
// telephonic, and CT/OR are sometimes cited with caveats) — this list is
// intentionally CONSERVATIVE for a sales-dialer context: when a lead is in one
// of these states the agent should announce the call is being recorded and
// confirm consent. Codes are uppercase USPS abbreviations.
export const TWO_PARTY_CONSENT_STATES: readonly string[] = [
  "CA", // California — Penal Code § 632
  "DE", // Delaware
  "FL", // Florida — § 934.03
  "IL", // Illinois — 720 ILCS 5/14-2
  "MD", // Maryland — Cts. & Jud. Proc. § 10-402
  "MA", // Massachusetts — Ch. 272 § 99
  "MI", // Michigan
  "MT", // Montana
  "NV", // Nevada
  "NH", // New Hampshire
  "PA", // Pennsylvania — 18 Pa.C.S. § 5703
  "WA", // Washington — RCW 9.73.030
];

/** True if `state` is a two-party (all-party) consent state. Case-insensitive. */
export function isTwoPartyConsentState(state: string | null | undefined): boolean {
  const code = (state ?? "").trim().toUpperCase();
  return TWO_PARTY_CONSENT_STATES.includes(code);
}

// ──────────────────────────────────────────────────────────────────
// Compliance object (pure)
// ──────────────────────────────────────────────────────────────────

/** Minimal Lead subset the compliance helper needs. */
export interface CopilotLeadInput {
  state?: string | null;
  dncFlagged?: boolean | null;
  tcpaVerifiedAt?: Date | string | null;
}

export interface CopilotCompliance {
  /** Is it within permitted calling hours in the lead's state right now? */
  withinCallingHours: boolean;
  /** Is the lead flagged on a Do-Not-Call registry? */
  dnc: boolean;
  /** Does the lead's state require all-party consent to record? */
  twoPartyConsent: boolean;
  /** Has TCPA consent been server-side verified (TrustedForm/Jornaya)? */
  tcpaVerified: boolean;
  /** Human-readable compliance warnings the agent must heed. */
  warnings: string[];
  /** The lead's (normalized) state code, for reference. */
  state: string;
}

/**
 * Produce a structured compliance object + human-readable warnings for a lead
 * at instant `now`. PURE — no I/O, no clock reads (the caller passes `now`).
 *
 * Warnings fire independently:
 *   - outside calling hours           → "Outside permitted calling hours"
 *   - DNC flagged                     → "Lead is on the DNC registry"
 *   - two-party-consent state         → "{STATE} is a two-party-consent state — announce recording ..."
 *   - TCPA not verified               → "TCPA consent not verified"
 */
export function buildCompliance(
  lead: CopilotLeadInput,
  now: Date = new Date(),
): CopilotCompliance {
  const state = (lead.state ?? "").trim().toUpperCase();

  // Reuse the platform's DST-aware, per-state, fail-closed calling-hours guard.
  const withinCallingHours = isWithinCallingHours(state, now).allowed;
  const dnc = lead.dncFlagged === true;
  const twoPartyConsent = isTwoPartyConsentState(state);
  const tcpaVerified = lead.tcpaVerifiedAt != null;

  const warnings: string[] = [];
  if (!withinCallingHours) {
    warnings.push("Outside permitted calling hours");
  }
  if (dnc) {
    warnings.push("Lead is on the DNC registry");
  }
  if (twoPartyConsent) {
    warnings.push(
      `${state} is a two-party-consent state — announce recording and confirm consent`,
    );
  }
  if (!tcpaVerified) {
    warnings.push("TCPA consent not verified");
  }

  return { withinCallingHours, dnc, twoPartyConsent, tcpaVerified, warnings, state };
}

// ──────────────────────────────────────────────────────────────────
// AI talking-point suggestions
// ──────────────────────────────────────────────────────────────────

/** Max number of suggestions we ever return. */
export const MAX_SUGGESTIONS = 3;
/** Max chars per suggestion line (guards against runaway LLM output). */
export const SUGGESTION_MAX_CHARS = 200;
/** Max chars of transcript we forward to the LLM (cost + prompt-injection surface). */
export const TRANSCRIPT_MAX_CHARS = 2000;

/** Small Lead subset used to contextualize the talking-point suggestions. */
export interface CopilotSuggestionLeadInput {
  type?: string | null;
  state?: string | null;
  consumerAge?: number | null;
  income?: string | null;
}

/**
 * Build the structured LLM prompt for talking-point suggestions. Pure, so the
 * exact shape can be asserted in tests. The transcript is clamped.
 */
export function buildSuggestionPrompt(
  lead: CopilotSuggestionLeadInput,
  transcript: string,
): { system: string; user: string } {
  const system =
    "You are a live-call sales copilot for a licensed Medicare/insurance agent. " +
    "Given the lead context and the recent call transcript, suggest up to 3 " +
    "concise, compliant next-best talking points. Return JSON " +
    "`{suggestions: string[]}`. Each suggestion is one short sentence, " +
    "actionable, and never promises specific plan approval or pricing.";

  const type = lead.type ?? "insurance";
  const state = lead.state ?? "unknown";
  const age = lead.consumerAge ?? "unknown";
  const income = lead.income ?? "unspecified income";
  const clipped = (transcript ?? "").slice(0, TRANSCRIPT_MAX_CHARS);

  const user =
    `Lead context:\n` +
    `- Product type: ${type}\n` +
    `- State: ${state}\n` +
    `- Age: ${age}\n` +
    `- Income bracket: ${income}\n\n` +
    `Recent transcript:\n"""\n${clipped}\n"""\n\n` +
    `Return only JSON matching {suggestions: string[]}. No prose, no markdown.`;

  return { system, user };
}

/**
 * Deterministic, context-aware fallback suggestions. Used when no LLM key is
 * configured (stub mode) or when the LLM returns unparseable output. Output is
 * stable for a given (type, state) pair so tests can assert exact strings.
 */
export function stubSuggestions(lead: CopilotSuggestionLeadInput): string[] {
  const type = lead.type ?? "insurance";
  const state = lead.state ?? "their state";
  return [
    `Confirm the consumer's current ${type} coverage and what prompted the inquiry.`,
    `Ask which doctors or medications must stay in-network before comparing ${type} plans in ${state}.`,
    `Summarize total annual cost (premium plus out-of-pocket), not just the monthly premium.`,
  ];
}

/**
 * Defensively parse a raw LLM response into a suggestions array. Strips
 * markdown fences, tolerates prose around the JSON, clamps length + count.
 * Returns `null` if no usable suggestions can be extracted.
 */
export function parseSuggestions(raw: string): string[] | null {
  if (!raw || typeof raw !== "string") return null;

  let body = raw.trim();
  const fenceMatch = body.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) body = fenceMatch[1].trim();

  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(body.slice(first, last + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.suggestions)) {
    return null;
  }

  const suggestions = parsed.suggestions
    .filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s: string) => {
      const t = s.trim();
      return t.length > SUGGESTION_MAX_CHARS
        ? t.slice(0, SUGGESTION_MAX_CHARS - 1).trimEnd() + "…"
        : t;
    })
    .slice(0, MAX_SUGGESTIONS);

  return suggestions.length > 0 ? suggestions : null;
}

/**
 * Generate up to `MAX_SUGGESTIONS` talking points for the lead + transcript.
 * Routes through the shared LLM abstraction; falls back to the deterministic
 * stub when no LLM key is set or the response is unparseable. Never throws for
 * an LLM/network error.
 */
export async function generateSuggestions(
  lead: CopilotSuggestionLeadInput,
  transcript: string,
): Promise<{ suggestions: string[]; modelUsed: string }> {
  const { system, user } = buildSuggestionPrompt(lead, transcript);

  let raw = "";
  let modelUsed = "stub";
  try {
    const resp = await chat({
      system,
      user,
      maxTokens: 300,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["suggestions"],
        properties: {
          suggestions: { type: "array", items: { type: "string" } },
        },
      },
    });
    raw = resp.text ?? "";
    modelUsed = resp.modelUsed || "stub";
  } catch {
    // network / parse failures fall through to the stub
  }

  const parsed = parseSuggestions(raw);
  if (parsed) {
    return { suggestions: parsed, modelUsed };
  }
  return {
    suggestions: stubSuggestions(lead),
    modelUsed: modelUsed === "stub" ? "stub" : `${modelUsed}+fallback`,
  };
}
