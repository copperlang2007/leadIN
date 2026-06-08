import { describe, it, expect } from "vitest";
import {
  STUB_MAPPING,
  buildPrompt,
  parseLlmResponse,
  classifyDispute,
  type Classification,
} from "./disputeClassifier";

describe("STUB_MAPPING", () => {
  it("covers every reason value the zod schema accepts", () => {
    expect(Object.keys(STUB_MAPPING).sort()).toEqual([
      "bad_contact",
      "duplicate",
      "fraud",
      "not_as_described",
      "other",
    ]);
  });

  it("bad_contact is the only high-confidence likely_valid", () => {
    expect(STUB_MAPPING.bad_contact.classification).toBe("likely_valid");
    expect(STUB_MAPPING.bad_contact.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("duplicate is likely_invalid", () => {
    expect(STUB_MAPPING.duplicate.classification).toBe("likely_invalid");
  });

  it("fraud / not_as_described / other → needs_review", () => {
    expect(STUB_MAPPING.fraud.classification).toBe("needs_review");
    expect(STUB_MAPPING.not_as_described.classification).toBe("needs_review");
    expect(STUB_MAPPING.other.classification).toBe("needs_review");
  });
});

describe("buildPrompt", () => {
  it("includes reason + notes + call summary", () => {
    const { system, user } = buildPrompt({
      reason: "bad_contact",
      notes: "Phone disconnected on first try",
      callLogSummary: "3 attempts, all no-answer",
    });
    expect(system).toMatch(/insurance-lead dispute reviewer/);
    expect(user).toContain("Reason: bad_contact");
    expect(user).toContain("Notes from buyer: Phone disconnected on first try");
    expect(user).toContain("Call log summary: 3 attempts, all no-answer");
  });

  it("omits absent optional fields", () => {
    const { user } = buildPrompt({ reason: "fraud" });
    expect(user).toBe("Reason: fraud");
  });
});

describe("parseLlmResponse", () => {
  it("parses well-formed JSON", () => {
    const r = parseLlmResponse(
      JSON.stringify({ classification: "likely_valid", confidence: 0.9, rationale: "ok" }),
      "bad_contact",
    );
    expect(r.classification).toBe("likely_valid");
    expect(r.confidence).toBe(0.9);
    expect(r.rationale).toBe("ok");
  });

  it("extracts JSON from prose noise", () => {
    const r = parseLlmResponse(
      `Sure! Here is my answer: {"classification":"likely_invalid","confidence":0.55,"rationale":"agent fault"}. Hope this helps!`,
      "duplicate",
    );
    expect(r.classification).toBe("likely_invalid");
    expect(r.confidence).toBe(0.55);
  });

  it("clamps confidence to [0,1]", () => {
    expect(parseLlmResponse(`{"classification":"likely_valid","confidence":1.5}`, "bad_contact").confidence).toBe(1);
    expect(parseLlmResponse(`{"classification":"likely_valid","confidence":-2}`, "bad_contact").confidence).toBe(0);
  });

  it("falls back to needs_review for unknown classification", () => {
    const r = parseLlmResponse(`{"classification":"banana","confidence":0.9}`, "fraud");
    expect(r.classification).toBe("needs_review");
  });

  it("falls back to stub mapping on parse failure", () => {
    const r = parseLlmResponse("not json at all", "bad_contact");
    expect(r.classification).toBe(STUB_MAPPING.bad_contact.classification);
    expect(r.confidence).toBe(STUB_MAPPING.bad_contact.confidence);
  });

  it("handles malformed JSON gracefully", () => {
    const r = parseLlmResponse(`{"classification": "likely_valid", confidence: }`, "bad_contact");
    expect(r.classification).toBe(STUB_MAPPING.bad_contact.classification);
  });

  it("truncates pathological rationale strings", () => {
    const huge = "x".repeat(2000);
    const r = parseLlmResponse(`{"classification":"likely_valid","confidence":0.5,"rationale":"${huge}"}`, "bad_contact");
    expect(r.rationale.length).toBeLessThanOrEqual(500);
  });
});

describe("classifyDispute (integration with stub LLM)", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("uses the deterministic stub mapping when no LLM key is set", async () => {
    const r = await classifyDispute({ reason: "bad_contact" });
    expect(r.classification).toBe("likely_valid");
    expect(r.confidence).toBe(0.85);
    expect(r.modelUsed).toBe("stub");
  });

  it("returns needs_review for unknown reasons via fallback", async () => {
    const r = await classifyDispute({ reason: "made_up_reason" as any });
    expect(r.classification).toBe("needs_review");
  });
});

import { beforeEach } from "vitest";

// Type-level smoke: Classification union is exhaustive
const _: Classification[] = ["likely_valid", "likely_invalid", "needs_review"];
void _;
