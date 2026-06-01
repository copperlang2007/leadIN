// Pure unit tests for the audit helper. No live DB — we inject a mock store
// via __setAuditStoreForTesting and assert on the exact values handed to
// drizzle's `insert().values(...)` and `select().from().where().orderBy().limit()` chain.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { adminAuditLog } from "@shared/schema";
import {
  recordAudit,
  listAudit,
  __setAuditStoreForTesting,
  type AuditStore,
} from "./audit";

interface MockInsertCall {
  table: unknown;
  values: unknown;
}

interface MockSelectChain {
  fromArg: unknown;
  whereArg: unknown;
  orderByArg: unknown;
  limitArg: unknown;
}

function makeMockStore(opts: {
  insertThrows?: boolean;
  selectRows?: unknown[];
} = {}) {
  const insertCalls: MockInsertCall[] = [];
  const selectChains: MockSelectChain[] = [];

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      insertCalls.push({ table, values });
      if (opts.insertThrows) throw new Error("simulated insert failure");
      return undefined;
    }),
  }));

  const rows = opts.selectRows ?? [];
  const select = vi.fn(() => {
    const chain: MockSelectChain = {
      fromArg: undefined,
      whereArg: undefined,
      orderByArg: undefined,
      limitArg: undefined,
    };
    const builder: any = {
      from(arg: unknown) {
        chain.fromArg = arg;
        return builder;
      },
      where(arg: unknown) {
        chain.whereArg = arg;
        return builder;
      },
      orderBy(arg: unknown) {
        chain.orderByArg = arg;
        return builder;
      },
      async limit(arg: unknown) {
        chain.limitArg = arg;
        selectChains.push(chain);
        return rows;
      },
    };
    return builder;
  });

  const store = { insert, select } as unknown as AuditStore;
  return { store, insertCalls, selectChains, insert, select };
}

describe("recordAudit", () => {
  let reset: (() => void) | undefined;

  afterEach(() => {
    reset?.();
    reset = undefined;
    vi.restoreAllMocks();
  });

  it("inserts a row with all fields when fully populated", async () => {
    const { store, insertCalls } = makeMockStore();
    reset = __setAuditStoreForTesting(store);

    await recordAudit({
      actorUserId: "u-1",
      orgId: "org-7",
      action: "agent.verification",
      targetKind: "user",
      targetId: "u-99",
      metadata: { status: "verified" },
    });

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe(adminAuditLog);
    expect(insertCalls[0].values).toEqual({
      actorUserId: "u-1",
      orgId: "org-7",
      action: "agent.verification",
      targetKind: "user",
      targetId: "u-99",
      metadata: { status: "verified" },
    });
  });

  it("normalises missing optional fields to null", async () => {
    const { store, insertCalls } = makeMockStore();
    reset = __setAuditStoreForTesting(store);

    await recordAudit({
      actorUserId: "u-1",
      action: "lead.remove",
    });

    expect(insertCalls[0].values).toEqual({
      actorUserId: "u-1",
      orgId: null,
      action: "lead.remove",
      targetKind: null,
      targetId: null,
      metadata: null,
    });
  });

  it("never throws when the underlying insert fails", async () => {
    const { store, insertCalls } = makeMockStore({ insertThrows: true });
    reset = __setAuditStoreForTesting(store);

    // Will not reject. We assert by awaiting normally.
    await expect(
      recordAudit({ actorUserId: "u-1", action: "vendor_key.mint" }),
    ).resolves.toBeUndefined();
    expect(insertCalls).toHaveLength(1);
  });

  it("preserves the exact action/target shape for vendor key mint", async () => {
    const { store, insertCalls } = makeMockStore();
    reset = __setAuditStoreForTesting(store);

    await recordAudit({
      actorUserId: "admin-1",
      orgId: "org-2",
      action: "vendor_key.mint",
      targetKind: "vendor",
      targetId: "42",
      metadata: { keyPrefix: "lcp_abc" },
    });

    expect(insertCalls[0].values).toMatchObject({
      action: "vendor_key.mint",
      targetKind: "vendor",
      targetId: "42",
      metadata: { keyPrefix: "lcp_abc" },
    });
  });
});

describe("listAudit", () => {
  let reset: (() => void) | undefined;

  afterEach(() => {
    reset?.();
    reset = undefined;
    vi.restoreAllMocks();
  });

  it("returns all rows with default limit when no filters are passed", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const { store, selectChains } = makeMockStore({ selectRows: rows });
    reset = __setAuditStoreForTesting(store);

    const result = await listAudit();

    expect(result).toBe(rows);
    expect(selectChains).toHaveLength(1);
    expect(selectChains[0].fromArg).toBe(adminAuditLog);
    expect(selectChains[0].whereArg).toBeUndefined();
    expect(selectChains[0].orderByArg).toBeDefined();
    expect(selectChains[0].limitArg).toBe(100);
  });

  it("applies a where clause when `action` filter is provided", async () => {
    const { store, selectChains } = makeMockStore({ selectRows: [] });
    reset = __setAuditStoreForTesting(store);

    await listAudit({ action: "lead.remove" });

    expect(selectChains[0].whereArg).toBeDefined();
  });

  it("applies a combined where clause when both filters are provided", async () => {
    const { store, selectChains } = makeMockStore({ selectRows: [] });
    reset = __setAuditStoreForTesting(store);

    await listAudit({ action: "agent.verification", actorUserId: "u-1" });

    // Both filters → drizzle `and(...)` is invoked; we can't see the AST, but
    // the where argument must be present and non-null.
    expect(selectChains[0].whereArg).toBeDefined();
    expect(selectChains[0].whereArg).not.toBeNull();
  });

  it("clamps limit into [1, 500] and floors fractional values", async () => {
    const { store, selectChains } = makeMockStore({ selectRows: [] });
    reset = __setAuditStoreForTesting(store);

    await listAudit({ limit: 0 });
    expect(selectChains.at(-1)!.limitArg).toBe(1);

    await listAudit({ limit: 9999 });
    expect(selectChains.at(-1)!.limitArg).toBe(500);

    await listAudit({ limit: 25.7 });
    expect(selectChains.at(-1)!.limitArg).toBe(25);
  });

  it("falls back to default limit when given a non-finite value", async () => {
    const { store, selectChains } = makeMockStore({ selectRows: [] });
    reset = __setAuditStoreForTesting(store);

    await listAudit({ limit: Number.NaN });

    expect(selectChains[0].limitArg).toBe(100);
  });
});
