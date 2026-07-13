// Unit tests for the pure helpers in ./dialerCopilot.ts.
//
// We exercise:
//   - isTwoPartyConsentState: positive + negative states, case-insensitivity
//   - buildCompliance: each warning firing / not firing, and the assembled
//     result (all-clear and all-warnings)
//   - buildSuggestionPrompt: contract / context inclusion + transcript clamp
//   - parseSuggestions: tolerant JSON parsing, fence stripping, clamping
//   - stubSuggestions: deterministic output for the no-LLM-key path
//   - generateSuggestions: returns the deterministic stub with no LLM key
//
// Everything here is pure or offline (no LLM key configured in CI), so the
// suite runs without network or a database.

import { describe, it, expect } from "vitest";
import {
  isTwoPartyConsentState,
  buildCompliance,
  buildSuggestionPrompt,
  parseSuggestions,
  redactPII,
  stubSuggestions,
  generateSuggestions,
  TWO_PARTY_CONSENT_STATES,
  MAX_SUGGESTIONS,
  SUGGESTION_MAX_CHARS,
  TRANSCRIPT_MAX_CHARS,
} from "./dialerCopilot";

// Fixed instants (July → US DST in effect for all continental zones).
// CA is single-zone Pacific (PDT = UTC-7).
const CA_WITHIN = new Date("2026-07-13T20:00:00Z"); // 13:00 PDT — inside 8–21
const CA_OUTSIDE = new Date("2026-07-13T06:00:00Z"); // 23:00 PDT prev day — outside
// TX spans Central + Mountain; 18:00Z → 13:00 CDT / 12:00 MDT — inside both.
const TX_WITHIN = new Date("2026-07-13T18:00:00Z");

describe("isTwoPartyConsentState", () => {
  it("returns true for EVERY state in the source list (kept in sync automatically)", () => {
    // Iterate the constant itself so a future edit to the list can't silently
    // drop a state (e.g. DE, NV) without a test failure.
    for (const s of TWO_PARTY_CONSENT_STATES) {
      expect(isTwoPartyConsentState(s)).toBe(true);
    }
    // Guard against the list being accidentally emptied.
    expect(TWO_PARTY_CONSENT_STATES.length).toBeGreaterThanOrEqual(11);
  });

  it("returns false for one-party-consent states (negative cases)", () => {
    for (const s of ["TX", "NY", "GA", "OH", "AZ", "CO"]) {
      expect(isTwoPartyConsentState(s)).toBe(false);
    }
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isTwoPartyConsentState("ca")).toBe(true);
    expect(isTwoPartyConsentState(" wa ")).toBe(true);
    expect(isTwoPartyConsentState("tx")).toBe(false);
  });

  it("handles null / undefined / empty safely", () => {
    expect(isTwoPartyConsentState(null)).toBe(false);
    expect(isTwoPartyConsentState(undefined)).toBe(false);
    expect(isTwoPartyConsentState("")).toBe(false);
  });

  it("named states from the requirement are all present in the list", () => {
    for (const s of ["CA", "FL", "IL", "MD", "MA", "MI", "MT", "NH", "PA", "WA"]) {
      expect(TWO_PARTY_CONSENT_STATES).toContain(s);
    }
  });
});

describe("buildCompliance — individual warnings", () => {
  it("fires 'Outside permitted calling hours' when outside the window", () => {
    const c = buildCompliance(
      { state: "CA", dncFlagged: false, tcpaVerifiedAt: new Date() },
      CA_OUTSIDE,
    );
    expect(c.withinCallingHours).toBe(false);
    expect(c.warnings).toContain("Outside permitted calling hours");
  });

  it("does NOT fire the calling-hours warning when inside the window", () => {
    const c = buildCompliance(
      { state: "CA", dncFlagged: false, tcpaVerifiedAt: new Date() },
      CA_WITHIN,
    );
    expect(c.withinCallingHours).toBe(true);
    expect(c.warnings).not.toContain("Outside permitted calling hours");
  });

  it("fires the DNC warning when dncFlagged is true", () => {
    const c = buildCompliance(
      { state: "TX", dncFlagged: true, tcpaVerifiedAt: new Date() },
      TX_WITHIN,
    );
    expect(c.dnc).toBe(true);
    expect(c.warnings).toContain("Lead is on the DNC registry");
  });

  it("does NOT fire the DNC warning when dncFlagged is false/null", () => {
    const c = buildCompliance(
      { state: "TX", dncFlagged: null, tcpaVerifiedAt: new Date() },
      TX_WITHIN,
    );
    expect(c.dnc).toBe(false);
    expect(c.warnings).not.toContain("Lead is on the DNC registry");
  });

  it("fires the two-party-consent warning naming the state", () => {
    const c = buildCompliance(
      { state: "CA", dncFlagged: false, tcpaVerifiedAt: new Date() },
      CA_WITHIN,
    );
    expect(c.twoPartyConsent).toBe(true);
    expect(
      c.warnings.some((w) => w.startsWith("CA is a two-party-consent state")),
    ).toBe(true);
  });

  it("does NOT fire the two-party warning for one-party states", () => {
    const c = buildCompliance(
      { state: "TX", dncFlagged: false, tcpaVerifiedAt: new Date() },
      TX_WITHIN,
    );
    expect(c.twoPartyConsent).toBe(false);
    expect(c.warnings.some((w) => w.includes("two-party-consent state"))).toBe(false);
  });

  it("fires the TCPA warning when tcpaVerifiedAt is null", () => {
    const c = buildCompliance(
      { state: "TX", dncFlagged: false, tcpaVerifiedAt: null },
      TX_WITHIN,
    );
    expect(c.tcpaVerified).toBe(false);
    expect(c.warnings).toContain("TCPA consent not verified");
  });

  it("does NOT fire the TCPA warning when tcpaVerifiedAt is set", () => {
    const c = buildCompliance(
      { state: "TX", dncFlagged: false, tcpaVerifiedAt: new Date("2026-01-01T00:00:00Z") },
      TX_WITHIN,
    );
    expect(c.tcpaVerified).toBe(true);
    expect(c.warnings).not.toContain("TCPA consent not verified");
  });

  it("treats a valid ISO-string tcpaVerifiedAt as verified, a malformed one as NOT", () => {
    const ok = buildCompliance(
      { state: "TX", dncFlagged: false, tcpaVerifiedAt: "2026-01-01T00:00:00Z" },
      TX_WITHIN,
    );
    expect(ok.tcpaVerified).toBe(true);

    const bad = buildCompliance(
      { state: "TX", dncFlagged: false, tcpaVerifiedAt: "not-a-date" },
      TX_WITHIN,
    );
    expect(bad.tcpaVerified).toBe(false);
    expect(bad.warnings).toContain("TCPA consent not verified");
  });
});

describe("buildCompliance — assembled result", () => {
  it("returns an all-clear compliance object with no warnings", () => {
    const c = buildCompliance(
      { state: "TX", dncFlagged: false, tcpaVerifiedAt: new Date("2026-01-01T00:00:00Z") },
      TX_WITHIN,
    );
    expect(c).toMatchObject({
      withinCallingHours: true,
      dnc: false,
      twoPartyConsent: false,
      tcpaVerified: true,
      state: "TX",
    });
    expect(c.warnings).toEqual([]);
  });

  it("fires all four warnings for a worst-case lead", () => {
    const c = buildCompliance(
      { state: "CA", dncFlagged: true, tcpaVerifiedAt: null },
      CA_OUTSIDE,
    );
    expect(c.withinCallingHours).toBe(false);
    expect(c.dnc).toBe(true);
    expect(c.twoPartyConsent).toBe(true);
    expect(c.tcpaVerified).toBe(false);
    expect(c.warnings).toHaveLength(4);
    expect(c.warnings).toContain("Outside permitted calling hours");
    expect(c.warnings).toContain("Lead is on the DNC registry");
    expect(c.warnings).toContain("TCPA consent not verified");
    expect(c.warnings.some((w) => w.startsWith("CA is a two-party-consent state"))).toBe(true);
  });

  it("normalizes and fails closed for an unknown state", () => {
    const c = buildCompliance(
      { state: "zz", dncFlagged: false, tcpaVerifiedAt: new Date() },
      CA_WITHIN,
    );
    // Unknown state → calling-hours helper fails closed → warning fires.
    expect(c.state).toBe("ZZ");
    expect(c.withinCallingHours).toBe(false);
    expect(c.warnings).toContain("Outside permitted calling hours");
  });
});

describe("buildSuggestionPrompt", () => {
  it("includes lead context and clamps the transcript", () => {
    const longTranscript = "~".repeat(TRANSCRIPT_MAX_CHARS + 500);
    const { system, user } = buildSuggestionPrompt(
      { type: "Medicare Advantage", state: "FL", consumerAge: 67, income: "50-75k" },
      longTranscript,
    );
    expect(system).toContain("sales copilot");
    expect(user).toContain("Medicare Advantage");
    expect(user).toContain("FL");
    expect(user).toContain("67");
    expect(user).toContain("50-75k");
    // The transcript must be clamped to exactly TRANSCRIPT_MAX_CHARS chars.
    expect((user.match(/~/g) ?? []).length).toBe(TRANSCRIPT_MAX_CHARS);
  });
});

describe("parseSuggestions", () => {
  it("parses a plain JSON object", () => {
    expect(parseSuggestions('{"suggestions":["a","b"]}')).toEqual(["a", "b"]);
  });

  it("strips markdown fences", () => {
    expect(parseSuggestions('```json\n{"suggestions":["x"]}\n```')).toEqual(["x"]);
  });

  it("tolerates prose around the JSON", () => {
    expect(parseSuggestions('Sure! {"suggestions":["y"]} hope that helps'))
      .toEqual(["y"]);
  });

  it("drops empty entries, clamps count and length", () => {
    const raw = JSON.stringify({
      suggestions: ["one", "  ", "two", "three", "four", "z".repeat(SUGGESTION_MAX_CHARS + 50)],
    });
    const parsed = parseSuggestions(raw)!;
    expect(parsed).toHaveLength(MAX_SUGGESTIONS);
    expect(parsed).toEqual(["one", "two", "three"]);
  });

  it("clamps an over-long suggestion to SUGGESTION_MAX_CHARS", () => {
    const raw = JSON.stringify({ suggestions: ["z".repeat(SUGGESTION_MAX_CHARS + 50)] });
    const parsed = parseSuggestions(raw)!;
    expect(parsed[0].length).toBe(SUGGESTION_MAX_CHARS);
    expect(parsed[0].endsWith("…")).toBe(true);
  });

  it("returns null for malformed / non-suggestion input", () => {
    expect(parseSuggestions("not json")).toBeNull();
    expect(parseSuggestions('{"nope":1}')).toBeNull();
    expect(parseSuggestions("")).toBeNull();
    expect(parseSuggestions('{"suggestions":[]}')).toBeNull();
  });

  it("takes the FIRST valid object when the model emits a second JSON fragment", () => {
    // Anthropic-style prose framing with a trailing unrelated object — the
    // outermost-brace span would fail to parse; the balanced scan must not.
    const raw = 'Sure! {"suggestions":["a","b"]} For example, another shape could be {"note":"be concise"}.';
    expect(parseSuggestions(raw)).toEqual(["a", "b"]);
  });

  it("skips a leading non-suggestions object and finds the real one", () => {
    const raw = '{"meta":{"x":1}} then {"suggestions":["real"]}';
    expect(parseSuggestions(raw)).toEqual(["real"]);
  });

  it("is not confused by braces inside string values", () => {
    expect(parseSuggestions('{"suggestions":["use {this} phrasing"]}')).toEqual(["use {this} phrasing"]);
  });

  it("recovers a trailing bare-JSON answer after a schema fence with no suggestions", () => {
    const input = '```json\n{"schema":true}\n```\n{"suggestions":["real"]}';
    expect(parseSuggestions(input)).toEqual(["real"]);
  });

  it("recovers a trailing bare-JSON answer after a prose fence", () => {
    const input = 'See below:\n```json\nExample text\n```\nAnswer: {"suggestions":["real"]}';
    expect(parseSuggestions(input)).toEqual(["real"]);
  });

  it("finds the real answer across MULTIPLE fenced blocks (preamble fence + answer fence)", () => {
    const raw =
      '```json\n{"schema":"suggestions[] of strings"}\n```\n' +
      'Here you go:\n```json\n{"suggestions":["real one","real two"]}\n```';
    expect(parseSuggestions(raw)).toEqual(["real one", "real two"]);
  });

  it("truncates on a codepoint boundary — never leaves a lone surrogate", () => {
    const emoji = "😀"; // 😀 (a surrogate pair)
    const long = "a".repeat(198) + emoji + "b".repeat(50);
    const [out] = parseSuggestions(JSON.stringify({ suggestions: [long] }))!;
    // No unpaired surrogate anywhere in the truncated output.
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = out.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
      }
    }
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("redactPII", () => {
  it("redacts SSN, card, email, and phone from a transcript", () => {
    const out = redactPII(
      "SSN 123-45-6789, card 4111 1111 1111 1111, email jane@doe.com, call 415-555-0100.",
    );
    expect(out).not.toContain("123-45-6789");
    expect(out).not.toContain("4111 1111 1111 1111");
    expect(out).not.toContain("jane@doe.com");
    expect(out).not.toContain("415-555-0100");
    expect(out).toContain("[redacted-ssn]");
    expect(out).toContain("[redacted-card]");
    expect(out).toContain("[redacted-email]");
    expect(out).toContain("[redacted-phone]");
  });

  it("leaves ordinary text untouched and handles empty input", () => {
    expect(redactPII("Discuss the Medicare Advantage plan options.")).toBe(
      "Discuss the Medicare Advantage plan options.",
    );
    expect(redactPII("")).toBe("");
  });

  it("preserves bare numeric IDs (MBI / order numbers), only redacting phone-shaped numbers", () => {
    expect(redactPII("My member ID is 1234567890, please look me up.")).toContain("1234567890");
    expect(redactPII("Order number 12025550100 has shipped.")).toContain("12025550100");
    // But a formatted phone with separators is still redacted.
    expect(redactPII("call 415-555-0100")).toContain("[redacted-phone]");
    expect(redactPII("call +1 415.555.0100")).toContain("[redacted-phone]");
  });
});

describe("stubSuggestions", () => {
  it("is deterministic and context-aware", () => {
    const a = stubSuggestions({ type: "Medicare Advantage", state: "FL" });
    const b = stubSuggestions({ type: "Medicare Advantage", state: "FL" });
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(a[0]).toContain("Medicare Advantage");
    expect(a[1]).toContain("FL");
  });

  it("falls back to sane defaults when fields are missing", () => {
    const s = stubSuggestions({});
    expect(s).toHaveLength(3);
    expect(s[0]).toContain("insurance");
  });
});

describe("generateSuggestions (no LLM key → deterministic stub)", () => {
  it("returns the deterministic stub with modelUsed 'stub' when no key is set", async () => {
    // CI/test env has neither OPENAI_API_KEY nor ANTHROPIC_API_KEY.
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const lead = { type: "Medicare Advantage", state: "FL", consumerAge: 67 };
    const result = await generateSuggestions(lead, "Consumer asked about dental coverage.");
    expect(result.modelUsed).toBe("stub");
    expect(result.suggestions).toEqual(stubSuggestions(lead));
    expect(result.suggestions).toHaveLength(3);
  });
});
