// Wave 6b (K3) — Click-to-call dialer + live AI conversation assist.
//
// The user-facing flow is: agent opens a lead dialog, clicks "Call now",
// Twilio places the call (or stubs it when creds are missing), the consumer
// audio is transcribed and pushed at /api/dialer/transcript, and every
// /TRIGGER_WINDOW_CHARS/-character window of the consumer text is scanned
// for "objection" phrases. When a phrase fires we ask the LLM to draft a
// short coaching line, persist it as a `conversation_assists` row, and
// broadcast it over the agent's WebSocket as `assist_suggestion`.
//
// The detection + suggestion pipeline is factored as pure async functions
// so it can be unit-tested without a Twilio account, an OpenAI key, or a
// running Postgres — the only stateful piece is the in-memory `lastWindow`
// dedupe cache, which is keyed by callLogId.
//
// Trigger phrases (Medicare sales coaching — copy/paste to docs):
//   cost, price, too expensive, network, doctor, side effects, deductible, copay

import { chat } from "./lib/llm";
import { startCall as twilioStartCall, isTwilioLive } from "./lib/twilio";
import { storage } from "./storage";

// ──────────────────────────────────────────────────────
// Trigger phrases + canned stub coaching lines.
// ──────────────────────────────────────────────────────

/**
 * Consumer-line phrases that should prompt a coaching whisper. Order is
 * significant: longer / more specific phrases come first so a transcript
 * line containing "too expensive" matches as "too expensive" rather than
 * the bare "expensive" or "cost" prefix.
 */
export const TRIGGER_PHRASES = [
  "too expensive",
  "side effects",
  "deductible",
  "copay",
  "network",
  "doctor",
  "price",
  "cost",
] as const;

export type TriggerPhrase = (typeof TRIGGER_PHRASES)[number];

/**
 * Canned LLM-free coaching lines so trigger detection + persistence keep
 * working in CI and in dev without an OPENAI/ANTHROPIC key. Each line is
 * <= 25 words to mirror the live LLM prompt budget.
 */
export const STUB_SUGGESTIONS: Record<TriggerPhrase, string> = {
  "too expensive":
    "Reframe value: total out-of-pocket including drugs is often lower than the premium they're comparing.",
  "side effects":
    "Acknowledge concern, then redirect to plan benefits — Medicare plans don't dictate medication, that's a doctor conversation.",
  "deductible":
    "Walk them through the deductible vs. max-out-of-pocket so they see the worst-case cap, not just the upfront number.",
  "copay":
    "Quote the tier-1 generic copay first — usually $0–$5 — so the number they hear anchors low.",
  "network":
    "Offer to look up their preferred doctor by name right now and confirm in-network status.",
  "doctor":
    "Ask which doctor they want to keep, then verify in-network before quoting any premium.",
  "price":
    "Pivot from monthly price to total annual cost including drugs and copays — it's almost always the better number.",
  "cost":
    "Anchor on annual total cost, not monthly premium. Mention $0-premium plans qualify in many ZIPs.",
};

// ──────────────────────────────────────────────────────
// Trigger detection (pure)
// ──────────────────────────────────────────────────────

/** Window of text we scan on each transcript chunk. */
export const TRIGGER_WINDOW_CHARS = 200;

/**
 * Scan the most recent /TRIGGER_WINDOW_CHARS/ chars of a transcript and
 * return the first trigger phrase that appears in it, or null.
 *
 * Matching is case-insensitive. Phrases are checked in the order declared
 * in TRIGGER_PHRASES so longer phrases win over shorter prefixes.
 */
export function detectTrigger(transcript: string): TriggerPhrase | null {
  if (!transcript) return null;
  const tail = transcript.slice(-TRIGGER_WINDOW_CHARS).toLowerCase();
  for (const phrase of TRIGGER_PHRASES) {
    if (tail.includes(phrase)) return phrase;
  }
  return null;
}

// ──────────────────────────────────────────────────────
// Per-call dedupe cache (in-memory)
// ──────────────────────────────────────────────────────
//
// We don't want to emit the same suggestion twice in a row when the
// consumer keeps saying "cost" across multiple transcript chunks. The
// cache stores the last trigger phrase per callLogId; identical
// back-to-back triggers are dropped. A different trigger resets the
// entry, so {cost → price → cost} emits three suggestions.

const lastTriggerByCall = new Map<number, TriggerPhrase>();

/** Test-only: reset the dedupe cache between cases. */
export function _resetTriggerCache(): void {
  lastTriggerByCall.clear();
}

// ──────────────────────────────────────────────────────
// Suggestion generation (LLM or stub)
// ──────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a Medicare sales coach. Given this consumer line, suggest one short coaching line (max 25 words).";

/**
 * Ask the LLM for a coaching line, or fall back to the canned stub when
 * lib/llm is in stub mode (no API key). The stub mode is detected by
 * checking that the returned `modelUsed` field is "stub".
 */
export async function generateSuggestion(
  trigger: TriggerPhrase,
  transcriptTail: string,
): Promise<string> {
  const response = await chat({
    system: SYSTEM_PROMPT,
    user: `Trigger: "${trigger}"\nConsumer said: ${transcriptTail.slice(-200)}`,
    maxTokens: 120,
  });
  if (response.modelUsed === "stub") {
    return STUB_SUGGESTIONS[trigger];
  }
  // Trim and cap at 25 words to match the prompt contract even if the LLM
  // ignores it.
  const words = response.text.trim().split(/\s+/);
  return words.length > 25 ? words.slice(0, 25).join(" ") : words.join(" ");
}

// ──────────────────────────────────────────────────────
// Top-level pipeline: process a transcript chunk
// ──────────────────────────────────────────────────────

export interface ProcessTranscriptDeps {
  /** Insert a row into `conversation_assists`. */
  recordAssist: (input: {
    callLogId: number;
    triggerPhrase: string;
    suggestion: string;
  }) => Promise<void>;
  /** Broadcast `assist_suggestion` over the agent WS. */
  broadcast: (payload: {
    callLogId: number;
    suggestion: string;
    triggerPhrase: string;
  }) => void;
}

export interface ProcessTranscriptInput {
  callLogId: number;
  /** Full transcript so far (we scan the last TRIGGER_WINDOW_CHARS). */
  transcript: string;
  /** Whether this chunk was a "partial" Twilio media-stream frame. */
  partial?: boolean;
}

export interface ProcessTranscriptResult {
  emitted: boolean;
  triggerPhrase?: TriggerPhrase;
  suggestion?: string;
  /** Why we did NOT emit: "no_trigger" | "dedupe" | "partial". */
  reason?: "no_trigger" | "dedupe" | "partial";
}

/**
 * One-shot pipeline used by the /api/dialer/transcript handler and by tests.
 *
 * Skips emission when: (a) the chunk is a partial frame — we only emit on
 * finalised text; (b) no trigger phrase matches in the recent window; or
 * (c) the same trigger fired on the previous emit for this call.
 */
export async function processTranscriptChunk(
  input: ProcessTranscriptInput,
  deps: ProcessTranscriptDeps,
): Promise<ProcessTranscriptResult> {
  if (input.partial) {
    return { emitted: false, reason: "partial" };
  }
  const trigger = detectTrigger(input.transcript);
  if (!trigger) {
    return { emitted: false, reason: "no_trigger" };
  }
  if (lastTriggerByCall.get(input.callLogId) === trigger) {
    return { emitted: false, reason: "dedupe", triggerPhrase: trigger };
  }

  const suggestion = await generateSuggestion(trigger, input.transcript);
  await deps.recordAssist({
    callLogId: input.callLogId,
    triggerPhrase: trigger,
    suggestion,
  });
  deps.broadcast({
    callLogId: input.callLogId,
    suggestion,
    triggerPhrase: trigger,
  });
  lastTriggerByCall.set(input.callLogId, trigger);
  return { emitted: true, triggerPhrase: trigger, suggestion };
}

// ──────────────────────────────────────────────────────
// Click-to-call entry point used by POST /api/dialer/call
// ──────────────────────────────────────────────────────

export interface StartCallResult {
  callLogId: number;
  twilioSid: string | null;
  status: string;
  stub: boolean;
}

/**
 * Insert a `call_logs` row in `queued` state, place the Twilio call (or
 * stub it), then update the row with the returned sid. We persist the
 * `queued` row first so the agent UI has a synchronous handle even when
 * Twilio is slow / unreachable.
 */
export async function startCallForLead(
  agentUserId: string,
  leadId: number,
): Promise<StartCallResult> {
  const lead = await storage.getLead(leadId);
  if (!lead) throw new Error(`lead ${leadId} not found`);
  const toPhone = lead.consumerPhone;
  if (!toPhone) throw new Error("lead has no consumer phone on file");

  const call = await storage.createCallLog({
    agentUserId,
    leadId,
    status: "queued",
  });

  try {
    const tw = await twilioStartCall({ fromAgentId: agentUserId, leadId, toPhone });
    await storage.updateCallLog(call.id, {
      twilioSid: tw.sid,
      status: tw.status || "queued",
    });
    return {
      callLogId: call.id,
      twilioSid: tw.sid,
      status: tw.status || "queued",
      stub: !isTwilioLive(),
    };
  } catch (err: any) {
    await storage.updateCallLog(call.id, { status: "failed" });
    throw err;
  }
}
