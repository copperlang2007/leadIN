// Wave 7 (T8) — Tests for the at-dial DNC gate.
//
// The gate is wired with injected deps (storage / checkDnc / recordAudit) so
// each test asserts behaviour without needing a DB or vendor.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { gateCallAgainstDnc, type GateDeps } from "./dncAtDial";

interface LeadRow {
  id: number;
  consumerPhone: string | null;
  dncFlagged: boolean | null;
}

function makeDeps(overrides: {
  lead?: LeadRow | undefined;
  flagged?: boolean;
  source?: string;
  reason?: string;
} = {}): {
  deps: GateDeps;
  setLeadDncStatus: ReturnType<typeof vi.fn>;
  checkDnc: ReturnType<typeof vi.fn>;
  recordAudit: ReturnType<typeof vi.fn>;
  getLead: ReturnType<typeof vi.fn>;
} {
  const getLead = vi.fn(async (_id: number) => overrides.lead);
  const setLeadDncStatus = vi.fn(async (_id: number, _flag: boolean) => {});
  const checkDnc = vi.fn(async (_phone: string | null | undefined) => ({
    flagged: overrides.flagged ?? false,
    source: overrides.source ?? "local-fallback",
    reason: overrides.reason,
  }));
  const recordAudit = vi.fn(async (_input: any) => {});
  return {
    deps: { getLead, setLeadDncStatus, checkDnc, recordAudit },
    getLead,
    setLeadDncStatus,
    checkDnc,
    recordAudit,
  };
}

describe("gateCallAgainstDnc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks when the lead does not exist", async () => {
    const { deps, checkDnc, setLeadDncStatus, recordAudit } = makeDeps({ lead: undefined });
    const r = await gateCallAgainstDnc(42, "user-1", deps);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not found/i);
    // No downstream side effects when the lead is missing.
    expect(checkDnc).not.toHaveBeenCalled();
    expect(setLeadDncStatus).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("blocks when the lead has no phone", async () => {
    const { deps, checkDnc, setLeadDncStatus, recordAudit } = makeDeps({
      lead: { id: 1, consumerPhone: null, dncFlagged: false },
    });
    const r = await gateCallAgainstDnc(1, "user-1", deps);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/no phone/i);
    expect(checkDnc).not.toHaveBeenCalled();
    expect(setLeadDncStatus).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("allows the call when DNC check comes back clean", async () => {
    const { deps, setLeadDncStatus, recordAudit } = makeDeps({
      lead: { id: 7, consumerPhone: "415-555-2671", dncFlagged: false },
      flagged: false,
    });
    const r = await gateCallAgainstDnc(7, "user-1", deps);
    expect(r.allowed).toBe(true);
    // Even when clean we persist the latest answer so dncCheckedAt is fresh.
    expect(setLeadDncStatus).toHaveBeenCalledWith(7, false);
    // No audit row on the happy path.
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("blocks the call when DNC check flags the phone and writes an audit row", async () => {
    const { deps, setLeadDncStatus, recordAudit } = makeDeps({
      lead: { id: 11, consumerPhone: "415-555-0000", dncFlagged: false },
      flagged: true,
      source: "local-fallback",
      reason: "local suppression match (0000)",
    });
    const r = await gateCallAgainstDnc(11, "agent-9", deps);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/0000|dnc/i);
    expect(setLeadDncStatus).toHaveBeenCalledWith(11, true);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditCall = recordAudit.mock.calls[0][0];
    expect(auditCall.action).toBe("dial.blocked_dnc");
    expect(auditCall.actorUserId).toBe("agent-9");
    expect(auditCall.targetKind).toBe("lead");
    expect(auditCall.targetId).toBe("11");
    expect(auditCall.metadata).toMatchObject({ leadId: 11, source: "local-fallback" });
  });

  it("uses 'system' as the default actor when no userId is supplied", async () => {
    const { deps, recordAudit } = makeDeps({
      lead: { id: 12, consumerPhone: "415-555-1111", dncFlagged: false },
      flagged: true,
    });
    await gateCallAgainstDnc(12, undefined as unknown as string, deps);
    // The route always passes a userId, but defensively the gate must still
    // produce an audit row with a non-empty actor.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit.mock.calls[0][0].actorUserId).toBe("system");
  });

  it("is idempotent: calling twice persists twice and audits twice when flagged", async () => {
    const { deps, setLeadDncStatus, recordAudit } = makeDeps({
      lead: { id: 5, consumerPhone: "415-555-9999", dncFlagged: false },
      flagged: true,
    });
    const r1 = await gateCallAgainstDnc(5, "u", deps);
    const r2 = await gateCallAgainstDnc(5, "u", deps);
    expect(r1.allowed).toBe(false);
    expect(r2.allowed).toBe(false);
    // Each call re-checks and re-persists; audit is append-only by design.
    expect(setLeadDncStatus).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenCalledTimes(2);
  });

  it("falls back to a generic reason when checkDnc does not provide one", async () => {
    const { deps } = makeDeps({
      lead: { id: 21, consumerPhone: "555-555-5555", dncFlagged: false },
      flagged: true,
      source: "vendor",
      reason: undefined,
    });
    const r = await gateCallAgainstDnc(21, "u", deps);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/dnc/i);
  });
});
