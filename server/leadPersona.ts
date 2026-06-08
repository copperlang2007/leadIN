// Wave 7 (T6) — Lead persona cache.
//
// When the purchaser (or an admin) opens the lead-details dialog we generate
// a short, structured persona that surfaces:
//
//   - `persona`            — a ~100-word narrative summary
//   - `predictedObjections`— string[] of likely sales objections
//   - `bestApproach`       — one-line tactical recommendation
//
// The result is cached in `lead_personas` (one row per lead). We re-generate
// if the cached row is older than `PERSONA_TTL_DAYS` so demographic prompts
// stay reasonably fresh without burning LLM cost on every view.
//
// All LLM calls go through `lib/llm.chat`, which falls back to a deterministic
// stub when no OPENAI/ANTHROPIC key is configured. To keep tests fast and the
// persona useful even in stub mode we always synthesise a sensible
// demographic-aware persona locally — the LLM merely refines it when keys
// are available. If the LLM returns malformed JSON we fall back to the same
// deterministic persona.
//
// `buildPersonaPrompt` and `parsePersonaResponse` are exported as pure
// helpers so the test file can assert on them directly.

import type { Lead } from "@shared/schema";
import { chat } from "./lib/llm";
import { storage } from "./storage";

export const PERSONA_TTL_DAYS = 7;
const PERSONA_TTL_MS = PERSONA_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Maximum length (chars) we will store for the persona narrative. */
export const PERSONA_MAX_CHARS = 1200;
/** Max number of objections we keep (prevents runaway LLM responses). */
export const PERSONA_MAX_OBJECTIONS = 6;
/** Max chars per objection / approach line. */
export const PERSONA_LINE_MAX_CHARS = 240;

export interface PersonaPayload {
  persona: string;
  predictedObjections: string[];
  bestApproach: string;
}

export interface CachedPersona extends PersonaPayload {
  generatedAt: Date | null;
  modelUsed: string | null;
}

/** Small subset of Lead fields the persona generator needs. */
export interface PersonaLeadInput {
  type?: string | null;
  state?: string | null;
  consumerAge?: number | null;
  income?: string | null;
  gender?: string | null;
  smoker?: boolean | null;
}

// ──────────────────────────────────────────────────────────────────
// Pure helpers (tested directly)
// ──────────────────────────────────────────────────────────────────

/**
 * Build the structured LLM prompt for persona generation. Kept pure so tests
 * can assert on the exact string shape and demographic fields are included.
 */
export function buildPersonaPrompt(lead: PersonaLeadInput): {
  system: string;
  user: string;
} {
  const system =
    "You write a 100-word insurance lead persona in JSON " +
    "`{persona: string, predictedObjections: string[], bestApproach: string}`. " +
    "Be specific to demographics. Persona must be <= 100 words. " +
    "Provide 3-5 objections. bestApproach is one sentence.";

  const age = lead.consumerAge ?? "unknown";
  const state = lead.state ?? "unknown";
  const type = lead.type ?? "insurance";
  const income = lead.income ?? "unspecified income";
  const gender =
    lead.gender === "M" ? "male" : lead.gender === "F" ? "female" : "unspecified";
  const smoker = lead.smoker === true ? "smoker" : lead.smoker === false ? "non-smoker" : "smoker status unknown";

  const user =
    `Lead demographics:\n` +
    `- Product type: ${type}\n` +
    `- State: ${state}\n` +
    `- Age: ${age}\n` +
    `- Income bracket: ${income}\n` +
    `- Gender: ${gender}\n` +
    `- ${smoker}\n\n` +
    `Return only JSON matching the schema. No prose, no markdown.`;

  return { system, user };
}

/** Truncate a string to `max` chars, appending an ellipsis on overflow. */
export function truncate(input: string, max: number): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (trimmed.length <= max) return trimmed;
  // Reserve one char for the ellipsis to keep the final length <= max.
  return trimmed.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Deterministic, demographic-aware fallback persona. Used in two cases:
 *   1. Stub LLM mode (no API keys configured)
 *   2. Real LLM returned malformed/unparseable JSON
 *
 * Output is stable for a given (type, state, age, smoker, income) tuple so
 * tests can assert exact strings.
 */
export function stubPersona(lead: PersonaLeadInput): PersonaPayload {
  const age = lead.consumerAge ?? 65;
  const state = lead.state ?? "US";
  const type = lead.type ?? "insurance";
  const income = lead.income ?? "middle-income";
  const smokerLabel =
    lead.smoker === true ? "smoker" : lead.smoker === false ? "non-smoker" : "unknown smoking status";

  const persona =
    `${age}yo ${state} resident on ${type}. ` +
    `${income} household, ${smokerLabel}. ` +
    `Likely concerns: monthly premium, network breadth, prescription costs. ` +
    `Best approach: lead with specific carrier comparison.`;

  const predictedObjections = [
    "Concerned about monthly premium increases",
    `Wants to keep current doctors in ${state} network`,
    "Worried about prescription drug coverage and copays",
    `Needs ${type} plan to match existing benefits`,
  ];

  const bestApproach =
    `Lead with a side-by-side carrier comparison for ${type} in ${state}; ` +
    `anchor on total annual cost (premium + out-of-pocket), not monthly price.`;

  return { persona, predictedObjections, bestApproach };
}

/**
 * Defensively parse a raw LLM response into a PersonaPayload. Strips markdown
 * fences, tolerates extra prose around the JSON object, and clamps lengths.
 * Returns `null` if no usable JSON object can be extracted.
 */
export function parsePersonaResponse(raw: string): PersonaPayload | null {
  if (!raw || typeof raw !== "string") return null;

  // Strip ```json ... ``` or ``` ... ``` fences if present.
  let body = raw.trim();
  const fenceMatch = body.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) body = fenceMatch[1].trim();

  // Fall back to substring between the first `{` and last `}`.
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const jsonStr = body.slice(first, last + 1);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const persona = typeof parsed.persona === "string" ? parsed.persona : "";
  const bestApproach =
    typeof parsed.bestApproach === "string" ? parsed.bestApproach : "";
  const rawObjections = Array.isArray(parsed.predictedObjections)
    ? parsed.predictedObjections
    : [];

  if (!persona.trim()) return null;

  const predictedObjections = rawObjections
    .filter((o: unknown): o is string => typeof o === "string" && o.trim().length > 0)
    .slice(0, PERSONA_MAX_OBJECTIONS)
    .map((o: string) => truncate(o, PERSONA_LINE_MAX_CHARS));

  return {
    persona: truncate(persona, PERSONA_MAX_CHARS),
    predictedObjections,
    bestApproach: truncate(bestApproach, PERSONA_LINE_MAX_CHARS),
  };
}

/**
 * Returns true if the cached row is fresh (younger than PERSONA_TTL_DAYS).
 */
export function isPersonaFresh(generatedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!generatedAt) return false;
  const ts = generatedAt instanceof Date ? generatedAt.getTime() : new Date(generatedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts < PERSONA_TTL_MS;
}

// ──────────────────────────────────────────────────────────────────
// DB-touching entry point
// ──────────────────────────────────────────────────────────────────

/**
 * Get the persona for a lead, generating + caching it if missing or stale.
 *
 * - If `force === true` we bypass the cache and re-generate.
 * - Caller is responsible for the authorization check (purchaser/admin).
 */
export async function getPersonaForLead(
  leadId: number,
  force: boolean = false,
): Promise<CachedPersona | null> {
  const lead = await storage.getLead(leadId);
  if (!lead) return null;

  if (!force) {
    const cached = await storage.getLeadPersona(leadId);
    if (cached && isPersonaFresh(cached.generatedAt ?? null)) {
      return {
        persona: cached.persona,
        predictedObjections: Array.isArray(cached.predictedObjections)
          ? (cached.predictedObjections as string[])
          : [],
        bestApproach: cached.bestApproach ?? "",
        generatedAt: cached.generatedAt ?? null,
        modelUsed: cached.modelUsed ?? null,
      };
    }
  }

  const { persona, modelUsed } = await generatePersona(lead);

  const saved = await storage.upsertLeadPersona({
    leadId,
    persona: persona.persona,
    predictedObjections: persona.predictedObjections,
    bestApproach: persona.bestApproach,
    modelUsed,
  });

  return {
    persona: saved.persona,
    predictedObjections: Array.isArray(saved.predictedObjections)
      ? (saved.predictedObjections as string[])
      : [],
    bestApproach: saved.bestApproach ?? "",
    generatedAt: saved.generatedAt ?? new Date(),
    modelUsed: saved.modelUsed ?? modelUsed,
  };
}

/**
 * Internal: call the LLM and parse the response, falling back to the
 * deterministic stub persona on any failure.
 */
async function generatePersona(
  lead: PersonaLeadInput,
): Promise<{ persona: PersonaPayload; modelUsed: string }> {
  const { system, user } = buildPersonaPrompt(lead);

  let modelUsed = "stub";
  let raw = "";
  try {
    const resp = await chat({
      system,
      user,
      maxTokens: 600,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["persona", "predictedObjections", "bestApproach"],
        properties: {
          persona: { type: "string" },
          predictedObjections: { type: "array", items: { type: "string" } },
          bestApproach: { type: "string" },
        },
      },
    });
    raw = resp.text ?? "";
    modelUsed = resp.modelUsed || "stub";
  } catch {
    // network / parse failures fall through to stub
  }

  const parsed = parsePersonaResponse(raw);
  if (parsed) {
    return { persona: parsed, modelUsed };
  }
  // Stub fallback: deterministic + demographic-aware.
  return { persona: stubPersona(lead), modelUsed: modelUsed === "stub" ? "stub" : `${modelUsed}+fallback` };
}

/** Convenience for callers that only need the lead-subset shape. */
export function toPersonaLeadInput(lead: Lead): PersonaLeadInput {
  return {
    type: lead.type ?? null,
    state: lead.state ?? null,
    consumerAge: lead.consumerAge ?? null,
    income: lead.income ?? null,
    gender: lead.gender ?? null,
    smoker: lead.smoker ?? null,
  };
}
