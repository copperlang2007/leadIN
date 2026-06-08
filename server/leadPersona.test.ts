// Wave 7 (T6) — Unit tests for the pure helpers in ./leadPersona.ts.
//
// We exercise:
//   - buildPersonaPrompt: contract / demographic inclusion
//   - parsePersonaResponse: tolerant JSON parsing, fence stripping, defaults
//   - truncate: bounds-check + ellipsis on overflow (string length cap)
//   - stubPersona: deterministic output for the no-LLM-key path
//   - isPersonaFresh: TTL window logic
//
// DB-touching getPersonaForLead is covered by integration tests that need a
// live Postgres; here we keep it fast and pure.

import { describe, it, expect } from "vitest";
import {
  buildPersonaPrompt,
  parsePersonaResponse,
  stubPersona,
  truncate,
  isPersonaFresh,
  PERSONA_MAX_OBJECTIONS,
  PERSONA_MAX_CHARS,
  PERSONA_LINE_MAX_CHARS,
  PERSONA_TTL_DAYS,
} from "./leadPersona";

describe("buildPersonaPrompt", () => {
  it("includes demographics in the user prompt", () => {
    const { system, user } = buildPersonaPrompt({
      type: "medicare",
      state: "FL",
      consumerAge: 67,
      income: "50k-75k",
      gender: "M",
      smoker: false,
    });
    expect(system).toMatch(/JSON/);
    expect(system).toMatch(/100-word/);
    expect(user).toContain("medicare");
    expect(user).toContain("FL");
    expect(user).toContain("67");
    expect(user).toContain("50k-75k");
    expect(user).toContain("male");
    expect(user).toContain("non-smoker");
  });

  it("substitutes sensible placeholders when fields are missing", () => {
    const { user } = buildPersonaPrompt({});
    expect(user).toContain("unknown"); // age
    expect(user).toContain("insurance"); // fallback type
  });

  it("instructs the LLM to return JSON only", () => {
    const { user } = buildPersonaPrompt({ type: "life", state: "TX", consumerAge: 45 });
    expect(user).toMatch(/Return only JSON/i);
  });
});

describe("parsePersonaResponse", () => {
  it("parses a well-formed JSON object", () => {
    const raw = JSON.stringify({
      persona: "65yo TX resident on medicare.",
      predictedObjections: ["price", "network"],
      bestApproach: "Compare plans.",
    });
    const parsed = parsePersonaResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.persona).toContain("TX");
    expect(parsed!.predictedObjections).toEqual(["price", "network"]);
    expect(parsed!.bestApproach).toBe("Compare plans.");
  });

  it("strips ```json``` fences", () => {
    const raw = "```json\n{\"persona\":\"x\",\"predictedObjections\":[\"a\"],\"bestApproach\":\"b\"}\n```";
    const parsed = parsePersonaResponse(raw);
    expect(parsed?.persona).toBe("x");
    expect(parsed?.predictedObjections).toEqual(["a"]);
  });

  it("recovers JSON embedded in surrounding prose", () => {
    const raw = 'Here you go: {"persona":"hi","predictedObjections":[],"bestApproach":"go"} thanks!';
    const parsed = parsePersonaResponse(raw);
    expect(parsed?.persona).toBe("hi");
    expect(parsed?.bestApproach).toBe("go");
  });

  it("returns null on completely invalid input", () => {
    expect(parsePersonaResponse("")).toBeNull();
    expect(parsePersonaResponse("not json at all")).toBeNull();
    expect(parsePersonaResponse("{ broken")).toBeNull();
  });

  it("returns null when persona is empty/missing", () => {
    expect(parsePersonaResponse('{"predictedObjections":[],"bestApproach":"x"}')).toBeNull();
    expect(parsePersonaResponse('{"persona":"  ","predictedObjections":[],"bestApproach":"x"}')).toBeNull();
  });

  it("clamps objections array length to PERSONA_MAX_OBJECTIONS", () => {
    const tooMany = Array.from({ length: 50 }, (_, i) => `obj-${i}`);
    const raw = JSON.stringify({
      persona: "p",
      predictedObjections: tooMany,
      bestApproach: "x",
    });
    const parsed = parsePersonaResponse(raw)!;
    expect(parsed.predictedObjections.length).toBe(PERSONA_MAX_OBJECTIONS);
    expect(parsed.predictedObjections[0]).toBe("obj-0");
  });

  it("filters non-string and empty objections defensively", () => {
    const raw = JSON.stringify({
      persona: "p",
      predictedObjections: ["valid", "", null, 42, "also valid"],
      bestApproach: "x",
    });
    const parsed = parsePersonaResponse(raw)!;
    expect(parsed.predictedObjections).toEqual(["valid", "also valid"]);
  });

  it("truncates over-long persona and best-approach", () => {
    const long = "a".repeat(PERSONA_MAX_CHARS + 500);
    const longLine = "b".repeat(PERSONA_LINE_MAX_CHARS + 100);
    const parsed = parsePersonaResponse(
      JSON.stringify({ persona: long, predictedObjections: [longLine], bestApproach: longLine }),
    )!;
    expect(parsed.persona.length).toBeLessThanOrEqual(PERSONA_MAX_CHARS);
    expect(parsed.bestApproach.length).toBeLessThanOrEqual(PERSONA_LINE_MAX_CHARS);
    expect(parsed.predictedObjections[0].length).toBeLessThanOrEqual(PERSONA_LINE_MAX_CHARS);
  });
});

describe("truncate", () => {
  it("returns input unchanged when within bounds", () => {
    expect(truncate("hello", 100)).toBe("hello");
  });
  it("trims whitespace before measuring", () => {
    expect(truncate("  hi  ", 100)).toBe("hi");
  });
  it("appends ellipsis on overflow and respects max", () => {
    const out = truncate("a".repeat(50), 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.endsWith("…")).toBe(true);
  });
  it("handles non-string input", () => {
    // @ts-expect-error testing defensive behaviour
    expect(truncate(undefined, 10)).toBe("");
  });
});

describe("stubPersona (deterministic, no-LLM-key path)", () => {
  it("is deterministic for the same inputs", () => {
    const lead = { type: "medicare", state: "FL", consumerAge: 67, smoker: false, income: "50k-75k" };
    const a = stubPersona(lead);
    const b = stubPersona(lead);
    expect(a).toEqual(b);
  });

  it("encodes the lead demographics into the narrative", () => {
    const out = stubPersona({ type: "medicare", state: "FL", consumerAge: 67, smoker: false });
    expect(out.persona).toContain("67");
    expect(out.persona).toContain("FL");
    expect(out.persona).toContain("medicare");
    expect(out.persona).toContain("non-smoker");
  });

  it("returns at least three concrete objections + a non-empty bestApproach", () => {
    const out = stubPersona({ type: "life", state: "TX", consumerAge: 45, smoker: true });
    expect(out.predictedObjections.length).toBeGreaterThanOrEqual(3);
    out.predictedObjections.forEach(o => expect(o.length).toBeGreaterThan(0));
    expect(out.bestApproach.length).toBeGreaterThan(0);
    expect(out.bestApproach).toContain("TX");
  });

  it("handles missing/null demographic fields without throwing", () => {
    const out = stubPersona({});
    expect(out.persona).toBeTruthy();
    expect(out.predictedObjections.length).toBeGreaterThan(0);
    expect(out.bestApproach).toBeTruthy();
  });

  it("differs when state or type differs (avoids one-size-fits-all output)", () => {
    const fl = stubPersona({ type: "medicare", state: "FL", consumerAge: 67 });
    const tx = stubPersona({ type: "medicare", state: "TX", consumerAge: 67 });
    expect(fl.persona).not.toBe(tx.persona);
    const life = stubPersona({ type: "life", state: "FL", consumerAge: 67 });
    expect(life.persona).not.toBe(fl.persona);
  });
});

describe("isPersonaFresh", () => {
  it("returns false for null/undefined timestamps", () => {
    expect(isPersonaFresh(null)).toBe(false);
    expect(isPersonaFresh(undefined)).toBe(false);
  });

  it("returns true for a timestamp within the TTL", () => {
    const recent = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
    expect(isPersonaFresh(recent)).toBe(true);
  });

  it("returns false once past the TTL window", () => {
    const stale = new Date(Date.now() - (PERSONA_TTL_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(isPersonaFresh(stale)).toBe(false);
  });

  it("respects an explicit `now` for deterministic checks", () => {
    const generatedAt = new Date("2026-01-01T00:00:00Z");
    const justInside = new Date("2026-01-07T23:59:00Z"); // < 7 days
    const justOutside = new Date("2026-01-08T01:00:00Z"); // > 7 days
    expect(isPersonaFresh(generatedAt, justInside)).toBe(true);
    expect(isPersonaFresh(generatedAt, justOutside)).toBe(false);
  });
});
