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
/** Coerce a date-ish value to a valid Date, or null if absent/unparseable. */
function toValidDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildCompliance(
  lead: CopilotLeadInput,
  now: Date = new Date(),
): CopilotCompliance {
  const state = (lead.state ?? "").trim().toUpperCase();

  // Reuse the platform's DST-aware, per-state, fail-closed calling-hours guard.
  const withinCallingHours = isWithinCallingHours(state, now).allowed;
  const dnc = lead.dncFlagged === true;
  const twoPartyConsent = isTwoPartyConsentState(state);
  // Only a VALID timestamp counts as verified — a malformed/unexpected value
  // (e.g. an unparseable string) must not read as "TCPA verified".
  const tcpaVerified = toValidDate(lead.tcpaVerifiedAt) !== null;

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

/**
 * Scrub obvious consumer PII from a call transcript before it's forwarded to
 * the external LLM provider. Structured lead fields already omit direct
 * identifiers; this reduces the chance a consumer-uttered SSN / card number /
 * email / phone is sent verbatim. Not exhaustive — a belt-and-braces measure
 * alongside the provider DPA, not a substitute for it.
 */
export function redactPII(text: string): string {
  if (!text) return text;
  return text
    // SSN (before card so 9-digit runs aren't mis-tagged)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
    // 13–16 digit card-like runs (allowing spaces/dashes between digits)
    .replace(/\b(?:\d[ -]?){13,16}\b/g, "[redacted-card]")
    // email addresses
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    // US-style phone numbers — require a +1 prefix or an actual separator
    // between the 3-3-4 groups, so bare digit runs (Medicare MBIs, order /
    // confirmation numbers) aren't clobbered and stripped of context.
    .replace(
      /\b(?:\+?1[-.\s]|\(1\)\s?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g,
      "[redacted-phone]",
    );
}

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
  // Same fallback as stubSuggestions so LLM- and stub-mode copy stay consistent.
  const state = lead.state ?? "their state";
  const age = lead.consumerAge ?? "unknown";
  const income = lead.income ?? "unspecified income";
  const clipped = redactPII((transcript ?? "").slice(0, TRANSCRIPT_MAX_CHARS));

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
  const body = raw.trim();

  // Try the WHOLE body first — this handles bare JSON and JSON that sits
  // outside a preceding fenced schema/example (a common Haiku framing where a
  // fence isn't the real answer). Only if that finds nothing do we fall back to
  // scanning each fenced block individually.
  const fromBody = scanForSuggestions(body);
  if (fromBody) return fromBody;
  for (const m of Array.from(body.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi))) {
    const fromFence = scanForSuggestions(m[1].trim());
    if (fromFence) return fromFence;
  }
  return null;
}

// Scan a string for the FIRST balanced {...} object that parses as
// { suggestions: string[] }. Taking the outermost brace span
// (indexOf('{')..lastIndexOf('}')) breaks whenever the model emits a second
// JSON fragment. Brace counting is string-aware so braces inside string values
// don't unbalance the scan.
function scanForSuggestions(body: string): string[] | null {
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < body.length; j++) {
      const ch = body[j];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const cleaned = clampSuggestions(body.slice(i, j + 1));
          if (cleaned) return cleaned;
          break; // not a suggestions object — try the next opening brace
        }
      }
    }
  }
  return null;
}

// Parse one JSON-object candidate into a clamped suggestions array, or null if
// it isn't a well-formed { suggestions: string[] }.
function clampSuggestions(candidate: string): string[] | null {
  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
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
      if (t.length <= SUGGESTION_MAX_CHARS) return t;
      // Codepoint-safe truncation: Array.from splits surrogate pairs correctly,
      // so an emoji straddling the limit never leaves a lone surrogate (which
      // would be invalid JSON on the wire and rejected by strict clients).
      let out = "";
      for (const cp of Array.from(t)) {
        if (out.length + cp.length > SUGGESTION_MAX_CHARS - 1) break;
        out += cp;
      }
      return out.trimEnd() + "…";
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
