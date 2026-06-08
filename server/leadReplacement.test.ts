// Unit tests for the Wave 7 (T1) lead replacement helpers.
//
// detectBadContact + computeCreditCents + isWithinReplacementWindow are
// pure and tested directly. The orchestration helpers
// (proposeReplacementCredit, autoIssueReplacement) use the injected
// ReplacementDeps facade so we can pass in plain in-memory mocks — no
// live DB.

import { describe, it, expect, vi } from "vitest";
import {
  autoIssueReplacement,
  batchExceedsBadThreshold,
  computeCreditCents,
  detectBadContact,
  isWithinReplacementWindow,
  proposeReplacementCredit,
  type ReplacementDeps,
} from "./leadReplacement";

// ──────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────

describe("detectBadContact", () => {
  it("returns 'insufficient' for empty call log lists", () => {
    expect(detectBadContact([])).toBe("insufficient");
  });

  it("returns 'bad' on 3+ no-answer/busy/failed attempts", () => {
    const logs = [
      { status: "no-answer" },
      { status: "busy" },
      { status: "failed" },
    ];
    expect(detectBadContact(logs)).toBe("bad");
  });

  it("returns 'ok' if any call completed (consumer reachable)", () => {
    const logs = [
      { status: "no-answer" },
      { status: "no-answer" },
      { status: "completed" },
      { status: "failed" },
    ];
    expect(detectBadContact(logs)).toBe("ok");
  });

  it("returns 'bad' when the DNC re-check flag is set (override)", () => {
    expect(detectBadContact([{ status: "completed" }], { dncFlagged: true })).toBe("bad");
  });

  it("treats a per-call dncFlagged stamp as bad even amid completed calls", () => {
    const logs = [
      { status: "completed" },
      { status: "no-answer", dncFlagged: true },
    ];
    expect(detectBadContact(logs)).toBe("bad");
  });

  it("returns 'insufficient' when failures exist but threshold isn't met", () => {
    expect(detectBadContact([{ status: "no-answer" }, { status: "busy" }])).toBe("insufficient");
  });

  it("ignores unknown statuses (e.g. 'queued', 'ringing') when counting", () => {
    const logs = [
      { status: "ringing" },
      { status: "queued" },
      { status: "in-progress" },
    ];
    expect(detectBadContact(logs)).toBe("insufficient");
  });
});

describe("computeCreditCents", () => {
  it("returns 50% of price in cents (Apple trade-in pattern)", () => {
    expect(computeCreditCents("100.00")).toBe(5_000);
    expect(computeCreditCents("49.99")).toBe(2_500); // 4999 * 0.5 = 2499.5 -> 2500 (half-up)
    expect(computeCreditCents(20)).toBe(1_000);
  });

  it("handles a custom fraction", () => {
    expect(computeCreditCents("100.00", 0.25)).toBe(2_500);
  });

  it("returns 0 for invalid/zero prices", () => {
    expect(computeCreditCents("0")).toBe(0);
    expect(computeCreditCents("-50")).toBe(0);
  });
});

describe("isWithinReplacementWindow", () => {
  const now = new Date("2026-06-08T12:00:00Z");

  it("returns true for orders within the 14-day window", () => {
    const created = new Date("2026-06-01T12:00:00Z");
    expect(isWithinReplacementWindow(created, now)).toBe(true);
  });

  it("returns false for orders older than 14 days", () => {
    const created = new Date("2026-05-20T00:00:00Z");
    expect(isWithinReplacementWindow(created, now)).toBe(false);
  });

  it("returns false for missing or invalid createdAt", () => {
    expect(isWithinReplacementWindow(null, now)).toBe(false);
    expect(isWithinReplacementWindow(undefined, now)).toBe(false);
    expect(isWithinReplacementWindow("not-a-date", now)).toBe(false);
  });
});

describe("batchExceedsBadThreshold", () => {
  it("returns true when more than half of the batch is bad", () => {
    expect(batchExceedsBadThreshold([
      { verdict: "bad" },
      { verdict: "bad" },
      { verdict: "bad" },
      { verdict: "ok" },
    ])).toBe(true);
  });

  it("returns false when exactly half — strict greater than", () => {
    expect(batchExceedsBadThreshold([
      { verdict: "bad" },
      { verdict: "ok" },
    ])).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(batchExceedsBadThreshold([])).toBe(false);
  });
});

// ──────────────────────────────────────────────────────
// Orchestration helpers (mocked deps)
// ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<ReplacementDeps> = {}): ReplacementDeps & {
  __spy: {
    created: any[];
    audits: any[];
    redemptions: { creditId: number; leadId: number }[];
  };
} {
  const created: any[] = [];
  const audits: any[] = [];
  const redemptions: { creditId: number; leadId: number }[] = [];

  const deps: any = {
    getOrder: async () => undefined,
    getCallLogsForOrder: async () => [],
    getCreditForOrder: async () => undefined,
    createTradeInCredit: async (input: any) => {
      const row = {
        id: created.length + 1,
        orderId: input.orderId,
        agentUserId: input.agentUserId,
        creditCents: input.creditCents,
        reason: input.reason ?? null,
        status: "issued" as const,
        redeemedAt: null,
        expiresAt: input.expiresAt ?? null,
        createdAt: new Date(),
      };
      created.push(row);
      return row;
    },
    redeemTradeInCredit: async (creditId: number, leadId: number) => {
      redemptions.push({ creditId, leadId });
      return {
        id: creditId,
        orderId: 1,
        agentUserId: "u",
        creditCents: 100,
        reason: null,
        status: "redeemed" as const,
        redeemedAt: new Date(),
        expiresAt: null,
        createdAt: new Date(),
      };
    },
    recordAudit: async (input: any) => {
      audits.push(input);
    },
    now: () => new Date("2026-06-08T12:00:00Z"),
    ...overrides,
  };
  return Object.assign(deps, { __spy: { created, audits, redemptions } });
}

describe("proposeReplacementCredit", () => {
  it("rejects when the order is missing", async () => {
    const deps = makeDeps();
    const r = await proposeReplacementCredit(42, deps);
    expect(r).toMatchObject({ eligible: false, reason: "order_not_found" });
  });

  it("rejects when a credit already exists for the order (idempotent)", async () => {
    const deps = makeDeps({
      getOrder: async () => ({
        id: 1,
        userId: "u1",
        leadId: 10,
        price: "100.00",
        createdAt: new Date("2026-06-08T11:00:00Z"),
        status: "completed",
      }) as any,
      getCreditForOrder: async () => ({ id: 7 }) as any,
    });
    const r = await proposeReplacementCredit(1, deps);
    expect(r).toMatchObject({ eligible: false, reason: "already_credited" });
  });

  it("rejects orders older than 14 days", async () => {
    const deps = makeDeps({
      getOrder: async () => ({
        id: 1,
        userId: "u1",
        leadId: 10,
        price: "100.00",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        status: "completed",
      }) as any,
    });
    const r = await proposeReplacementCredit(1, deps);
    expect(r).toMatchObject({ eligible: false, reason: "order_too_old" });
  });

  it("rejects with verdict-ok when the consumer was reachable", async () => {
    const deps = makeDeps({
      getOrder: async () => ({
        id: 1,
        userId: "u1",
        leadId: 10,
        price: "100.00",
        createdAt: new Date("2026-06-07T00:00:00Z"),
        status: "completed",
      }) as any,
      getCallLogsForOrder: async () => [
        { status: "completed" } as any,
      ],
    });
    const r = await proposeReplacementCredit(1, deps);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("verdict_ok");
    expect(r.verdict).toBe("ok");
  });

  it("approves with a 50% credit when 3 calls failed and order is fresh", async () => {
    const deps = makeDeps({
      getOrder: async () => ({
        id: 1,
        userId: "u1",
        leadId: 10,
        price: "100.00",
        createdAt: new Date("2026-06-07T00:00:00Z"),
        status: "completed",
      }) as any,
      getCallLogsForOrder: async () => [
        { status: "no-answer" } as any,
        { status: "busy" } as any,
        { status: "failed" } as any,
      ],
    });
    const r = await proposeReplacementCredit(1, deps);
    expect(r).toMatchObject({
      eligible: true,
      reason: "bad_contact_detected",
      creditCents: 5_000,
      verdict: "bad",
    });
  });
});

describe("autoIssueReplacement", () => {
  it("issues a credit when eligible and records an audit", async () => {
    const deps = makeDeps({
      getOrder: async () => ({
        id: 1,
        userId: "u1",
        leadId: 10,
        price: "200.00",
        createdAt: new Date("2026-06-07T00:00:00Z"),
        status: "completed",
      }) as any,
      getCallLogsForOrder: async () => [
        { status: "no-answer" } as any,
        { status: "no-answer" } as any,
        { status: "failed" } as any,
      ],
    });
    const r = await autoIssueReplacement(1, deps);
    expect(r.issued).toBe(true);
    expect(r.creditCents).toBe(10_000);
    expect(r.credit?.orderId).toBe(1);
    expect(r.credit?.agentUserId).toBe("u1");
    expect(r.credit?.status).toBe("issued");
    expect(r.credit?.expiresAt).toBeInstanceOf(Date);
    expect(deps.__spy.created).toHaveLength(1);
    expect(deps.__spy.audits).toHaveLength(1);
    expect(deps.__spy.audits[0]).toMatchObject({
      action: "tradein_credit.auto_issued",
      targetKind: "order",
      targetId: "1",
    });
  });

  it("returns {issued:false} when not eligible and does not call createTradeInCredit", async () => {
    const deps = makeDeps({
      getOrder: async () => ({
        id: 1,
        userId: "u1",
        leadId: 10,
        price: "100.00",
        createdAt: new Date("2026-06-08T11:00:00Z"),
        status: "completed",
      }) as any,
      // Only 1 failure — not enough to trip the threshold.
      getCallLogsForOrder: async () => [{ status: "no-answer" } as any],
    });
    const createSpy = vi.fn();
    deps.createTradeInCredit = createSpy;
    const r = await autoIssueReplacement(1, deps);
    expect(r.issued).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("does not roll back the credit when audit recording throws", async () => {
    const deps = makeDeps({
      getOrder: async () => ({
        id: 9,
        userId: "u1",
        leadId: 10,
        price: "50.00",
        createdAt: new Date("2026-06-07T00:00:00Z"),
        status: "completed",
      }) as any,
      getCallLogsForOrder: async () => [
        { status: "no-answer" } as any,
        { status: "busy" } as any,
        { status: "failed" } as any,
      ],
      recordAudit: async () => { throw new Error("audit boom"); },
    });
    const r = await autoIssueReplacement(9, deps);
    expect(r.issued).toBe(true);
    expect(r.creditCents).toBe(2_500);
  });

  it("treats a DNC-flagged lead as bad even with zero call logs (via per-call flag)", async () => {
    const deps = makeDeps({
      getOrder: async () => ({
        id: 5,
        userId: "u1",
        leadId: 10,
        price: "80.00",
        createdAt: new Date("2026-06-07T00:00:00Z"),
        status: "completed",
      }) as any,
      // Single call with DNC stamped — same verdict as 3+ failures.
      getCallLogsForOrder: async () => [
        { status: "failed", dncFlagged: true } as any,
      ],
    });
    const r = await autoIssueReplacement(5, deps);
    expect(r.issued).toBe(true);
    expect(r.creditCents).toBe(4_000);
  });
});
