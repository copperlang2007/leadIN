// Wave 7 (T7) — Tests for the TCPA-safe SMS outreach pipeline.
//
// We test the pure renderer + opt-out detection directly, and drive
// sendOutreach with injected fakes (storage, sendSms, takeToken) so the
// suite needs no DB, no Redis, and no Twilio creds.

import { describe, it, expect } from "vitest";
import {
  ALLOWED_VARS,
  OPT_OUT_FOOTER,
  TEMPLATES,
  getTemplate,
  hasRecentOptOut,
  isStopMessage,
  listTemplates,
  renderTemplate,
  withOptOutFooter,
  sendOutreach,
  InvalidPlaceholderError,
  MissingPurchaseError,
  OptedOutError,
  RateLimitExceededError,
  UnknownTemplateError,
  NoConsumerPhoneError,
} from "./smsOutreach";

// ──────────────────────────────────────────────────────
// Template registry
// ──────────────────────────────────────────────────────

describe("template registry", () => {
  it("exposes at least 5 canned templates with the required keys", () => {
    const keys = TEMPLATES.map((t) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "intro",
        "appointment_reminder",
        "follow_up",
        "missed_call",
        "compliance_check",
      ]),
    );
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it("every template body references an existing relationship (not cold contact)", () => {
    const cues = [
      "recent call",
      "our call",
      "scheduled",
      "discussed",
      "followed up",
      "following up",
      "follow up",
      "follow-up",
      "tried calling",
      "requested",
      "confirming",
      "quote",
    ];
    for (const tpl of TEMPLATES) {
      const body = tpl.body.toLowerCase();
      const hasCue = cues.some((c) => body.includes(c));
      expect(hasCue, `template "${tpl.key}" body must reference a prior interaction`).toBe(true);
    }
  });

  it("every template only declares allowed variables", () => {
    for (const tpl of TEMPLATES) {
      for (const v of tpl.variables) {
        expect(ALLOWED_VARS).toContain(v);
      }
    }
  });

  it("getTemplate looks up by key; listTemplates returns the full registry", () => {
    expect(getTemplate("intro")?.key).toBe("intro");
    expect(getTemplate("does-not-exist")).toBeUndefined();
    expect(listTemplates().length).toBe(TEMPLATES.length);
  });
});

// ──────────────────────────────────────────────────────
// renderTemplate + footer
// ──────────────────────────────────────────────────────

describe("renderTemplate", () => {
  it("substitutes allowed placeholders", () => {
    const out = renderTemplate("Hi {firstName}, this is {agentName} in {state}.", {
      firstName: "Pat",
      agentName: "Robin",
      state: "FL",
    });
    expect(out).toBe("Hi Pat, this is Robin in FL.");
  });

  it("rejects unknown placeholders in the body", () => {
    expect(() =>
      renderTemplate("Hi {firstName}, your SSN is {ssn}.", { firstName: "Pat" }),
    ).toThrow(InvalidPlaceholderError);
  });

  it("rejects unknown keys in the variables map even if not used", () => {
    expect(() =>
      renderTemplate("Hi {firstName}", { firstName: "Pat", ssn: "999" } as any),
    ).toThrow(InvalidPlaceholderError);
  });

  it("missing optional values render as empty (no raw {token} leakage)", () => {
    const out = renderTemplate("Hi {firstName}.", {});
    expect(out).toBe("Hi .");
    expect(out).not.toContain("{");
  });
});

describe("withOptOutFooter", () => {
  it("appends the TCPA opt-out footer", () => {
    expect(withOptOutFooter("Hi.")).toBe(`Hi. ${OPT_OUT_FOOTER}`);
  });

  it("is idempotent — does not double the footer", () => {
    const once = withOptOutFooter("Hi.");
    expect(withOptOutFooter(once)).toBe(once);
  });
});

// ──────────────────────────────────────────────────────
// STOP detection + opt-out window
// ──────────────────────────────────────────────────────

describe("isStopMessage", () => {
  it("detects standalone STOP / UNSUBSCRIBE / CANCEL (case-insensitive)", () => {
    expect(isStopMessage("stop")).toBe(true);
    expect(isStopMessage("STOP")).toBe(true);
    expect(isStopMessage("Unsubscribe")).toBe(true);
    expect(isStopMessage("CANCEL")).toBe(true);
  });

  it("detects STOP followed by punctuation/space", () => {
    expect(isStopMessage("STOP please")).toBe(true);
    expect(isStopMessage("stop.")).toBe(true);
  });

  it("does NOT false-positive on legitimate messages containing 'stop'", () => {
    expect(isStopMessage("I'll stop by tomorrow")).toBe(false);
    expect(isStopMessage("non-stop excitement")).toBe(false);
  });
});

describe("hasRecentOptOut", () => {
  const now = new Date("2026-06-08T12:00:00Z");

  it("returns true when an inbound STOP arrived in the last 30 days", () => {
    expect(
      hasRecentOptOut(
        [{ direction: "in", body: "STOP", createdAt: new Date("2026-06-01T12:00:00Z") }],
        now,
      ),
    ).toBe(true);
  });

  it("ignores STOPs older than 30 days", () => {
    expect(
      hasRecentOptOut(
        [{ direction: "in", body: "STOP", createdAt: new Date("2026-04-01T12:00:00Z") }],
        now,
      ),
    ).toBe(false);
  });

  it("ignores outbound STOPs (only inbound counts)", () => {
    expect(
      hasRecentOptOut(
        [{ direction: "out", body: "STOP", createdAt: new Date("2026-06-01T12:00:00Z") }],
        now,
      ),
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────
// sendOutreach pipeline
// ──────────────────────────────────────────────────────

interface FakeStorageState {
  orders: Map<string, { agentUserId: string; leadId: number }>; // key: agent:lead
  leads: Map<number, { id: number; consumerPhone: string | null }>;
  logs: Array<{ id: number; agentUserId: string; leadId: number; direction: string; body: string; status: string; createdAt: Date }>;
  nextLogId: number;
}

function makeFakes(initial?: Partial<FakeStorageState>) {
  const state: FakeStorageState = {
    orders: initial?.orders ?? new Map(),
    leads: initial?.leads ?? new Map(),
    logs: initial?.logs ?? [],
    nextLogId: initial?.nextLogId ?? 1,
  };
  const storage = {
    getOrderForLead: async (agentUserId: string, leadId: number) =>
      state.orders.get(`${agentUserId}:${leadId}`),
    getLead: async (leadId: number) => state.leads.get(leadId),
    createSmsLog: async (input: any) => {
      const row = {
        id: state.nextLogId++,
        agentUserId: input.agentUserId,
        leadId: input.leadId,
        direction: input.direction,
        body: input.body,
        status: input.status,
        twilioSid: input.twilioSid ?? null,
        createdAt: new Date(),
      };
      state.logs.push(row);
      return row;
    },
    listSmsLogsForLead: async (leadId: number, agentUserId: string) =>
      state.logs.filter((l) => l.leadId === leadId && l.agentUserId === agentUserId),
  } as any;
  const sentMessages: Array<{ toPhone: string; body: string }> = [];
  const sendSms = async (params: any) => {
    sentMessages.push({ toPhone: params.toPhone, body: params.body });
    return { sid: "stub:abc123", status: "queued" };
  };
  return { state, storage, sendSms, sentMessages };
}

describe("sendOutreach", () => {
  const AGENT = "agent-1";
  const LEAD_ID = 42;

  function setupPurchased() {
    const fakes = makeFakes({
      orders: new Map([[`${AGENT}:${LEAD_ID}`, { agentUserId: AGENT, leadId: LEAD_ID }]]),
      leads: new Map([[LEAD_ID, { id: LEAD_ID, consumerPhone: "+15555550100" }]]),
    });
    return fakes;
  }

  it("refuses to send when the agent has not purchased the lead", async () => {
    const fakes = makeFakes({
      leads: new Map([[LEAD_ID, { id: LEAD_ID, consumerPhone: "+15555550100" }]]),
    });
    await expect(
      sendOutreach(
        { agentUserId: AGENT, leadId: LEAD_ID, templateKey: "intro", variables: { firstName: "Pat", agentName: "Robin" } },
        {
          storage: fakes.storage,
          sendSms: fakes.sendSms,
          takeToken: async () => true,
        },
      ),
    ).rejects.toBeInstanceOf(MissingPurchaseError);
    expect(fakes.sentMessages).toHaveLength(0);
  });

  it("refuses unknown templates", async () => {
    const fakes = setupPurchased();
    await expect(
      sendOutreach(
        { agentUserId: AGENT, leadId: LEAD_ID, templateKey: "totally-fake" },
        { storage: fakes.storage, sendSms: fakes.sendSms, takeToken: async () => true },
      ),
    ).rejects.toBeInstanceOf(UnknownTemplateError);
  });

  it("sends a rendered message with the opt-out footer attached", async () => {
    const fakes = setupPurchased();
    const result = await sendOutreach(
      {
        agentUserId: AGENT,
        leadId: LEAD_ID,
        templateKey: "intro",
        variables: { firstName: "Pat", agentName: "Robin" },
      },
      { storage: fakes.storage, sendSms: fakes.sendSms, takeToken: async () => true },
    );
    expect(fakes.sentMessages).toHaveLength(1);
    const sent = fakes.sentMessages[0];
    expect(sent.toPhone).toBe("+15555550100");
    expect(sent.body).toContain("Pat");
    expect(sent.body).toContain("Robin");
    expect(sent.body).toContain(OPT_OUT_FOOTER);
    expect(result.smsLogId).toBeGreaterThan(0);
    expect(result.twilioSid).toBe("stub:abc123");
    // Persisted log includes the rendered body + footer.
    expect(fakes.state.logs).toHaveLength(1);
    expect(fakes.state.logs[0].direction).toBe("out");
    expect(fakes.state.logs[0].body).toBe(sent.body);
  });

  it("rejects placeholders that aren't in the allowlist", async () => {
    const fakes = setupPurchased();
    await expect(
      sendOutreach(
        {
          agentUserId: AGENT,
          leadId: LEAD_ID,
          templateKey: "intro",
          // ssn is not allowed — should reject without dispatching.
          variables: { firstName: "Pat", agentName: "Robin", ssn: "999" } as any,
        },
        { storage: fakes.storage, sendSms: fakes.sendSms, takeToken: async () => true },
      ),
    ).rejects.toBeInstanceOf(InvalidPlaceholderError);
    expect(fakes.sentMessages).toHaveLength(0);
  });

  it("refuses sending when an inbound STOP arrived within 30 days", async () => {
    const fakes = setupPurchased();
    // Seed an inbound STOP that was received yesterday.
    fakes.state.logs.push({
      id: fakes.state.nextLogId++,
      agentUserId: AGENT,
      leadId: LEAD_ID,
      direction: "in",
      body: "STOP",
      status: "received",
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await expect(
      sendOutreach(
        { agentUserId: AGENT, leadId: LEAD_ID, templateKey: "intro", variables: { firstName: "Pat", agentName: "Robin" } },
        { storage: fakes.storage, sendSms: fakes.sendSms, takeToken: async () => true },
      ),
    ).rejects.toBeInstanceOf(OptedOutError);
    expect(fakes.sentMessages).toHaveLength(0);
  });

  it("propagates rate-limit denials as RateLimitExceededError", async () => {
    const fakes = setupPurchased();
    await expect(
      sendOutreach(
        { agentUserId: AGENT, leadId: LEAD_ID, templateKey: "intro", variables: { firstName: "Pat", agentName: "Robin" } },
        { storage: fakes.storage, sendSms: fakes.sendSms, takeToken: async () => false },
      ),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
    expect(fakes.sentMessages).toHaveLength(0);
  });

  it("refuses leads without a consumer phone on file", async () => {
    const fakes = makeFakes({
      orders: new Map([[`${AGENT}:${LEAD_ID}`, { agentUserId: AGENT, leadId: LEAD_ID }]]),
      leads: new Map([[LEAD_ID, { id: LEAD_ID, consumerPhone: null }]]),
    });
    await expect(
      sendOutreach(
        { agentUserId: AGENT, leadId: LEAD_ID, templateKey: "intro", variables: { firstName: "Pat", agentName: "Robin" } },
        { storage: fakes.storage, sendSms: fakes.sendSms, takeToken: async () => true },
      ),
    ).rejects.toBeInstanceOf(NoConsumerPhoneError);
  });
});
