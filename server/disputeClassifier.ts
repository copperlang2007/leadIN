// Wave 7 — T2: AI dispute classifier.
//
// On dispute creation, fire-and-forget into the LLM to pre-classify the
// dispute as `likely_valid | likely_invalid | needs_review` with a 0..1
// confidence. Admin UI uses the classification + confidence to surface a
// one-click "Auto-approve" CTA on high-confidence valid disputes.
//
// The stub backend (used in tests and when no LLM key is configured) is
// deterministic: it maps the dispute reason to a fixed classification +
// confidence. This keeps unit tests stable without network calls.

import { chat } from "./lib/llm";

export type Classification = "likely_valid" | "likely_invalid" | "needs_review";

export interface ClassifierInput {
  reason: string; // one of: bad_contact | duplicate | fraud | not_as_described | other
  notes?: string | null;
  callLogSummary?: string;
}

export interface ClassificationResult {
  classification: Classification;
  confidence: number;
  rationale: string;
  modelUsed: string;
}

// Deterministic stub table. Returned verbatim when the LLM client reports
// `modelUsed: "stub"` OR when JSON parsing fails — keeps the system from
// getting stuck without classification.
export const STUB_MAPPING: Record<string, { classification: Classification; confidence: number; rationale: string }> = {
  bad_contact:      { classification: "likely_valid",   confidence: 0.85, rationale: "Bad-contact disputes are usually verifiable from dialer logs." },
  duplicate:        { classification: "likely_invalid", confidence: 0.70, rationale: "Duplicate claims often arise from agent error rather than vendor fault." },
  fraud:            { classification: "needs_review",   confidence: 0.50, rationale: "Fraud allegations need manual evidence review." },
  not_as_described: { classification: "needs_review",   confidence: 0.60, rationale: "Description mismatches require side-by-side comparison." },
  other:            { classification: "needs_review",   confidence: 0.50, rationale: "Unstructured reason — defer to admin." },
};

const VALID_CLASSIFICATIONS = new Set<string>([
  "likely_valid",
  "likely_invalid",
  "needs_review",
]);

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 100) / 100;
}

function fallbackFromReason(reason: string): { classification: Classification; confidence: number; rationale: string } {
  return STUB_MAPPING[reason] ?? STUB_MAPPING.other;
}

// Build the LLM prompt. Kept pure so we can snapshot-test it.
export function buildPrompt(input: ClassifierInput): { system: string; user: string } {
  const system = [
    "You are a senior insurance-lead dispute reviewer.",
    "Given a buyer-filed dispute, classify it as `likely_valid`, `likely_invalid`, or `needs_review`.",
    "Reply ONLY with valid JSON: { \"classification\": \"...\", \"confidence\": 0..1, \"rationale\": \"short reason\" }.",
    "Confidence reflects how certain you are. Use needs_review when evidence is mixed or absent.",
  ].join(" ");
  const user = [
    `Reason: ${input.reason}`,
    input.notes ? `Notes from buyer: ${input.notes}` : null,
    input.callLogSummary ? `Call log summary: ${input.callLogSummary}` : null,
  ].filter(Boolean).join("\n");
  return { system, user };
}

// Parse the LLM response into a ClassificationResult. Robust against:
//   - extra prose before/after the JSON block
//   - missing fields
//   - confidence out of range / non-numeric
//   - unknown classification strings
export function parseLlmResponse(text: string, fallbackReason: string): { classification: Classification; confidence: number; rationale: string } {
  if (!text) return fallbackFromReason(fallbackReason);
  // Try direct parse first, then extract { ... } substring.
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* fall through */ }
  if (!parsed) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* still fall through */ }
    }
  }
  if (!parsed || typeof parsed !== "object") return fallbackFromReason(fallbackReason);

  const cls = String(parsed.classification ?? "");
  const classification: Classification = VALID_CLASSIFICATIONS.has(cls as Classification)
    ? (cls as Classification)
    : "needs_review";
  const confidence = clampConfidence(parsed.confidence);
  const rationale = typeof parsed.rationale === "string" && parsed.rationale.length > 0
    ? parsed.rationale.slice(0, 500)
    : fallbackFromReason(fallbackReason).rationale;
  return { classification, confidence, rationale };
}

export async function classifyDispute(input: ClassifierInput): Promise<ClassificationResult> {
  const { system, user } = buildPrompt(input);
  let response: { text: string; modelUsed: string };
  try {
    response = await chat({ system, user, maxTokens: 200 });
  } catch {
    // Network / API failure: graceful fallback.
    const fb = fallbackFromReason(input.reason);
    return { ...fb, modelUsed: "stub-fallback" };
  }

  // Stub mode: deterministic mapping from reason.
  if (response.modelUsed === "stub") {
    const fb = fallbackFromReason(input.reason);
    return { ...fb, modelUsed: "stub" };
  }

  const parsed = parseLlmResponse(response.text, input.reason);
  return { ...parsed, modelUsed: response.modelUsed };
}
