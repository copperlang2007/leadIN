// Wave 6b (K3) — Tests for the dialer trigger pipeline.
//
// We exercise the pure detection + the side-effecting pipeline. The
// pipeline takes its DB / WS effects as injected callbacks, so we drive
// it without a real database or websocket server.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TRIGGER_PHRASES,
  STUB_SUGGESTIONS,
  TRIGGER_WINDOW_CHARS,
  detectTrigger,
  generateSuggestion,
  processTranscriptChunk,
  _resetTriggerCache,
} from "./dialer";

// Ensure LLM is in stub mode so generateSuggestion returns canned text.
beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  _resetTriggerCache();
});

afterEach(() => {
  _resetTriggerCache();
});

// ──────────────────────────────────────────────────────
// detectTrigger
// ──────────────────────────────────────────────────────

describe("detectTrigger", () => {
  it("returns null on an empty / non-trigger transcript", () => {
    expect(detectTrigger("")).toBeNull();
    expect(detectTrigger("hello, how are you today?")).toBeNull();
  });

  it("matches each trigger phrase case-insensitively", () => {
    expect(detectTrigger("the COST is too high")).toBe("cost");
    expect(detectTrigger("what about Side Effects?")).toBe("side effects");
    expect(detectTrigger("my DEDUCTIBLE matters")).toBe("deductible");
    expect(detectTrigger("network coverage?")).toBe("network");
    expect(detectTrigger("see my doctor")).toBe("doctor");
    expect(detectTrigger("the copay")).toBe("copay");
  });

  it("prefers longer / more specific phrases (too expensive before cost)", () => {
    // Phrase order in TRIGGER_PHRASES puts "too expensive" first.
    expect(detectTrigger("this plan is too expensive and the cost is high")).toBe("too expensive");
  });

  it("only scans the trailing window so old text doesn't re-trigger forever", () => {
    const head = "cost ".repeat(50); // 250 chars — pushes "cost" out of the tail
    const tail = "a".repeat(TRIGGER_WINDOW_CHARS);
    expect(detectTrigger(head + tail)).toBeNull();
  });

  it("exposes the full canonical trigger list to the UI / docs", () => {
    expect(TRIGGER_PHRASES).toContain("cost");
    expect(TRIGGER_PHRASES).toContain("price");
    expect(TRIGGER_PHRASES).toContain("too expensive");
    expect(TRIGGER_PHRASES).toContain("network");
    expect(TRIGGER_PHRASES).toContain("doctor");
    expect(TRIGGER_PHRASES).toContain("side effects");
    expect(TRIGGER_PHRASES).toContain("deductible");
    expect(TRIGGER_PHRASES).toContain("copay");
  });
});

// ──────────────────────────────────────────────────────
// generateSuggestion — stub mode
// ──────────────────────────────────────────────────────

describe("generateSuggestion (stub mode)", () => {
  it("returns the canned suggestion when no LLM key is configured", async () => {
    const out = await generateSuggestion("cost", "the cost is too high");
    expect(out).toBe(STUB_SUGGESTIONS["cost"]);
  });

  it("returns a stub line for every declared trigger phrase", async () => {
    for (const phrase of TRIGGER_PHRASES) {
      const out = await generateSuggestion(phrase, `consumer mentioned ${phrase}`);
      expect(out).toBe(STUB_SUGGESTIONS[phrase]);
      expect(out.split(/\s+/).length).toBeLessThanOrEqual(25);
    }
  });
});

// ──────────────────────────────────────────────────────
// processTranscriptChunk — full pipeline w/ injected effects
// ──────────────────────────────────────────────────────

function makeDeps() {
  const assists: Array<{ callLogId: number; triggerPhrase: string; suggestion: string }> = [];
  const broadcasts: Array<{ callLogId: number; suggestion: string; triggerPhrase: string }> = [];
  return {
    assists,
    broadcasts,
    recordAssist: vi.fn(async (input: { callLogId: number; triggerPhrase: string; suggestion: string }) => {
      assists.push(input);
    }),
    broadcast: vi.fn((payload: { callLogId: number; suggestion: string; triggerPhrase: string }) => {
      broadcasts.push(payload);
    }),
  };
}

describe("processTranscriptChunk", () => {
  it("emits a suggestion when a trigger phrase appears", async () => {
    const d = makeDeps();
    const r = await processTranscriptChunk(
      { callLogId: 1, transcript: "the cost is too high for me" },
      d,
    );
    expect(r.emitted).toBe(true);
    expect(r.triggerPhrase).toBe("cost");
    expect(r.suggestion).toBe(STUB_SUGGESTIONS["cost"]);
    expect(d.assists).toHaveLength(1);
    expect(d.broadcasts).toHaveLength(1);
    expect(d.broadcasts[0].callLogId).toBe(1);
  });

  it("does not emit when no trigger phrase fires", async () => {
    const d = makeDeps();
    const r = await processTranscriptChunk(
      { callLogId: 2, transcript: "hi, thanks for calling me" },
      d,
    );
    expect(r.emitted).toBe(false);
    expect(r.reason).toBe("no_trigger");
    expect(d.recordAssist).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("skips partial frames so we only coach on finalised text", async () => {
    const d = makeDeps();
    const r = await processTranscriptChunk(
      { callLogId: 3, transcript: "the cost is too high", partial: true },
      d,
    );
    expect(r.emitted).toBe(false);
    expect(r.reason).toBe("partial");
    expect(d.recordAssist).not.toHaveBeenCalled();
  });

  it("dedupes back-to-back triggers of the same phrase per call", async () => {
    const d = makeDeps();
    const first = await processTranscriptChunk(
      { callLogId: 7, transcript: "the cost worries me" },
      d,
    );
    expect(first.emitted).toBe(true);

    const second = await processTranscriptChunk(
      { callLogId: 7, transcript: "the cost worries me, the cost cost cost" },
      d,
    );
    expect(second.emitted).toBe(false);
    expect(second.reason).toBe("dedupe");
    expect(d.assists).toHaveLength(1);
    expect(d.broadcasts).toHaveLength(1);
  });

  it("re-emits when a different trigger phrase fires after the first", async () => {
    const d = makeDeps();
    await processTranscriptChunk({ callLogId: 8, transcript: "what about cost?" }, d);
    await processTranscriptChunk(
      { callLogId: 8, transcript: "what about cost? and the deductible?" },
      d,
    );
    expect(d.assists).toHaveLength(2);
    expect(d.assists.map((a) => a.triggerPhrase)).toEqual(["cost", "deductible"]);
  });

  it("keeps dedupe state per-call so two simultaneous calls don't interfere", async () => {
    const d = makeDeps();
    await processTranscriptChunk({ callLogId: 100, transcript: "price?" }, d);
    await processTranscriptChunk({ callLogId: 200, transcript: "price?" }, d);
    // Same trigger but different calls → both should fire.
    expect(d.assists.map((a) => a.callLogId).sort()).toEqual([100, 200]);
  });

  it("persists the trigger phrase verbatim on each assist record", async () => {
    const d = makeDeps();
    await processTranscriptChunk(
      { callLogId: 9, transcript: "the plan is too expensive" },
      d,
    );
    expect(d.assists[0].triggerPhrase).toBe("too expensive");
    expect(d.assists[0].suggestion).toBe(STUB_SUGGESTIONS["too expensive"]);
  });
});
