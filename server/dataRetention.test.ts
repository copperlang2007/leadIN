// Pure unit tests for the data retention sweep. No live DB — we inject
// mock stores via __setRetentionStoreForTesting and __setAuditStoreForTesting
// and assert on the values passed to drizzle's builder methods.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  runDataRetentionSweep,
  __setRetentionStoreForTesting,
  type RetentionStore,
} from "./dataRetention";
import { __setAuditStoreForTesting, type AuditStore } from "./audit";
import { piiRetentionPolicies, leads } from "@shared/schema";

interface MockUpdateCall {
  table: unknown;
  setValues: unknown;
  returnedIds?: number[];
}

function makeRetentionStore(opts: {
  policies?: any[];
  scrubbedIdsByOrg?: Record<string, number[]>;
}) {
  const updateCalls: MockUpdateCall[] = [];
  const select = vi.fn(() => {
    const builder: any = {
      from() { return builder; },
      where: async () => opts.policies ?? [],
    };
    return builder;
  });

  const update = vi.fn((table: unknown) => {
    const call: MockUpdateCall = { table, setValues: undefined };
    updateCalls.push(call);
    return {
      set(values: unknown) {
        call.setValues = values;
        return {
          where(_whereArg: unknown) {
            // For leads scrub: chain ends with .returning()
            // For policy lastSweepAt: chain ends here (await directly)
            return {
              then: async (resolve: (v: any) => any) => resolve(undefined),
              returning: async () => {
                // Use the table identity to find which org was being scrubbed.
                // The .where chain captured org id implicitly — we infer from
                // the most recent update on `leads` by looking at the policies
                // queue order.
                if (table === leads) {
                  // We use a simple strategy: in test, pull the first remaining
                  // org id from the queue.
                  const orgIds = Object.keys(opts.scrubbedIdsByOrg ?? {});
                  const orgId = orgIds[updateCalls.filter(c => c.table === leads).length - 1];
                  const ids = opts.scrubbedIdsByOrg?.[orgId] ?? [];
                  call.returnedIds = ids;
                  return ids.map((id) => ({ id }));
                }
                return [];
              },
            };
          },
        };
      },
    };
  });

  const store = { select, update } as unknown as RetentionStore;
  return { store, updateCalls };
}

function makeAuditStore() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      inserts.push({ table, values });
      return undefined;
    }),
  }));
  const store = { insert, select: vi.fn() } as unknown as AuditStore;
  return { store, inserts };
}

describe("runDataRetentionSweep", () => {
  let resetRetention: (() => void) | undefined;
  let resetAudit: (() => void) | undefined;

  afterEach(() => {
    resetRetention?.();
    resetAudit?.();
    resetRetention = undefined;
    resetAudit = undefined;
    vi.restoreAllMocks();
  });

  it("returns zero counts when there are no enabled policies", async () => {
    const { store } = makeRetentionStore({ policies: [] });
    resetRetention = __setRetentionStoreForTesting(store);
    const { store: audit } = makeAuditStore();
    resetAudit = __setAuditStoreForTesting(audit);

    const result = await runDataRetentionSweep();
    expect(result).toEqual({
      policiesEvaluated: 0,
      orgsScrubbed: 0,
      leadsScrubbed: 0,
    });
  });

  it("scrubs PII columns to null and counts orgs/leads correctly", async () => {
    const { store, updateCalls } = makeRetentionStore({
      policies: [
        { id: 1, orgId: "org-a", leadPiiDays: 365, autoDeleteEnabled: true },
        { id: 2, orgId: "org-b", leadPiiDays: 30, autoDeleteEnabled: true },
      ],
      scrubbedIdsByOrg: { "org-a": [101, 102, 103], "org-b": [201] },
    });
    resetRetention = __setRetentionStoreForTesting(store);
    const { store: audit, inserts } = makeAuditStore();
    resetAudit = __setAuditStoreForTesting(audit);

    const result = await runDataRetentionSweep();
    expect(result).toEqual({
      policiesEvaluated: 2,
      orgsScrubbed: 2,
      leadsScrubbed: 4,
    });

    // Each scrub UPDATE should set all four PII columns to null.
    const scrubCalls = updateCalls.filter((c) => c.table === leads);
    expect(scrubCalls).toHaveLength(2);
    for (const c of scrubCalls) {
      expect(c.setValues).toEqual({
        consumerName: null,
        consumerPhone: null,
        consumerEmail: null,
        consumerAddress: null,
      });
    }

    // One audit row per org that actually had scrubbed leads.
    expect(inserts).toHaveLength(2);
    const actions = inserts.map((i: any) => i.values.action);
    expect(actions.every((a) => a === "data_retention.lead_pii_scrubbed")).toBe(true);
    const counts = inserts.map((i: any) => (i.values.metadata as any).leadCount).sort();
    expect(counts).toEqual([1, 3]);

    // Each policy gets its lastSweepAt bumped.
    const policyUpdates = updateCalls.filter((c) => c.table === piiRetentionPolicies);
    expect(policyUpdates).toHaveLength(2);
    for (const u of policyUpdates) {
      expect((u.setValues as any).lastSweepAt).toBeInstanceOf(Date);
    }
  });

  it("does not write an audit row when no leads needed scrubbing", async () => {
    const { store } = makeRetentionStore({
      policies: [{ id: 1, orgId: "org-a", leadPiiDays: 365, autoDeleteEnabled: true }],
      scrubbedIdsByOrg: { "org-a": [] },
    });
    resetRetention = __setRetentionStoreForTesting(store);
    const { store: audit, inserts } = makeAuditStore();
    resetAudit = __setAuditStoreForTesting(audit);

    const result = await runDataRetentionSweep();
    expect(result.policiesEvaluated).toBe(1);
    expect(result.orgsScrubbed).toBe(0);
    expect(result.leadsScrubbed).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("uses the policy.leadPiiDays as the retention window", async () => {
    // Different policies should produce different cutoffs. The test
    // captures the policy fields used; the actual cutoff math is
    // exercised indirectly through the audit metadata.
    const { store } = makeRetentionStore({
      policies: [{ id: 1, orgId: "org-a", leadPiiDays: 7, autoDeleteEnabled: true }],
      scrubbedIdsByOrg: { "org-a": [1] },
    });
    resetRetention = __setRetentionStoreForTesting(store);
    const { store: audit, inserts } = makeAuditStore();
    resetAudit = __setAuditStoreForTesting(audit);

    const now = new Date("2026-06-09T12:00:00Z");
    await runDataRetentionSweep(now);

    const auditMeta = (inserts[0].values as any).metadata;
    const cutoff = new Date(auditMeta.cutoff);
    const expected = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(cutoff.toISOString()).toBe(expected.toISOString());
  });
});
