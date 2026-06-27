import { describe, it, expect } from "vitest";
import {
  decideLiveConnectBilling,
  settleLiveConnect,
  DEFAULT_POLICY,
  type ConnectEvent,
} from "./liveConnectBilling";

function evt(over: Partial<ConnectEvent> = {}): ConnectEvent {
  return {
    connectId: "CA123",
    leadId: 1,
    buyerId: "u1",
    agentAnswered: true,
    talkSeconds: 120,
    intentScore: 70,
    consentOnFile: true,
    ...over,
  };
}

describe("decideLiveConnectBilling", () => {
  it("bills a clean qualified live connect", () => {
    const d = decideLiveConnectBilling(evt());
    expect(d.billable).toBe(true);
    expect(d.failedGates).toEqual([]);
  });

  it("does not bill voicemail / no live answer", () => {
    const d = decideLiveConnectBilling(evt({ agentAnswered: false }));
    expect(d.billable).toBe(false);
    expect(d.failedGates).toContain("no_live_answer");
  });

  it("does not bill short calls below the talk-time threshold", () => {
    const d = decideLiveConnectBilling(evt({ talkSeconds: 30 }));
    expect(d.billable).toBe(false);
    expect(d.failedGates).toContain("talk_time_below_min");
  });

  it("does not bill low-intent connects", () => {
    const d = decideLiveConnectBilling(evt({ intentScore: 10 }));
    expect(d.billable).toBe(false);
    expect(d.failedGates).toContain("intent_below_min");
  });

  it("does not bill without consent when policy requires it", () => {
    const d = decideLiveConnectBilling(evt({ consentOnFile: false }));
    expect(d.billable).toBe(false);
    expect(d.failedGates).toContain("no_consent");
  });

  it("is idempotent: never bills an already-billed connect", () => {
    const d = decideLiveConnectBilling(evt({ alreadyBilled: true }));
    expect(d.billable).toBe(false);
    expect(d.failedGates).toContain("already_billed");
  });

  it("reports every failed gate at once", () => {
    const d = decideLiveConnectBilling(
      evt({ agentAnswered: false, talkSeconds: 0, intentScore: 0, consentOnFile: false }),
    );
    expect(d.billable).toBe(false);
    expect(d.failedGates).toEqual(
      expect.arrayContaining(["no_live_answer", "talk_time_below_min", "intent_below_min", "no_consent"]),
    );
  });

  it("honors a custom policy", () => {
    const d = decideLiveConnectBilling(evt({ talkSeconds: 45, intentScore: 20, consentOnFile: false }), {
      minTalkSeconds: 30,
      minIntentScore: 10,
      requireConsent: false,
    });
    expect(d.billable).toBe(true);
  });
});

describe("settleLiveConnect", () => {
  const factors = { basePrice: 40, mediscore: 100, intentScore: 100, exclusivity: "Exclusive", demandIndex: 1 };

  it("charges the dynamic intent price when billable", () => {
    const r = settleLiveConnect(evt(), factors);
    expect(r.decision.billable).toBe(true);
    // 40 * 1.5 * 1.6 * 1.5 * 1 = 144.00
    expect(r.amount).toBe("144.00");
    expect(r.pricing).not.toBeNull();
  });

  it("charges nothing and returns no pricing when not billable", () => {
    const r = settleLiveConnect(evt({ agentAnswered: false }), factors);
    expect(r.decision.billable).toBe(false);
    expect(r.amount).toBe("0.00");
    expect(r.pricing).toBeNull();
  });

  it("DEFAULT_POLICY matches the documented live-transfer bar", () => {
    expect(DEFAULT_POLICY.minTalkSeconds).toBe(90);
    expect(DEFAULT_POLICY.requireConsent).toBe(true);
  });
});
