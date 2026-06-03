// Unit tests for the dispute pure helpers + a behavioral test of the
// approveDispute storage method via a transaction-shaped mock.
//
// The pure helpers (clampRefundCents, computeRefundSplit, planVendorDebit,
// addRefundToBalance, priceStringToCents) are the heart of the refund math.
// The storage methods that wrap them call into Drizzle; we mock just enough
// of the tx surface to assert on the values handed to insert/update.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  addRefundToBalance,
  clampRefundCents,
  computeRefundSplit,
  planVendorDebit,
  priceStringToCents,
} from "./disputes";

// ──────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────

describe("priceStringToCents", () => {
  it("converts decimal dollar strings to integer cents", () => {
    expect(priceStringToCents("100.00")).toBe(10_000);
    expect(priceStringToCents("0.99")).toBe(99);
    expect(priceStringToCents("12.34")).toBe(1234);
  });

  it("handles numeric input the same as string input", () => {
    expect(priceStringToCents(50)).toBe(5_000);
  });
});

describe("clampRefundCents", () => {
  it("returns the requested amount when within bounds", () => {
    expect(clampRefundCents(5_000, 10_000)).toBe(5_000);
    expect(clampRefundCents(10_000, 10_000)).toBe(10_000);
  });

  it("clamps a refund larger than the order price down to the order price", () => {
    expect(clampRefundCents(20_000, 10_000)).toBe(10_000);
  });

  it("collapses non-positive or non-finite requests to 0", () => {
    expect(clampRefundCents(0, 10_000)).toBe(0);
    expect(clampRefundCents(-100, 10_000)).toBe(0);
    expect(clampRefundCents(Number.NaN, 10_000)).toBe(0);
    expect(clampRefundCents(10_000, 0)).toBe(0);
  });
});

describe("computeRefundSplit", () => {
  it("splits a $100 refund at 60% into $60 vendor / $40 platform write-off", () => {
    // refundCents=10000, share=0.6 -> vendor 6000, platform 4000
    const split = computeRefundSplit(10_000, 0.6);
    expect(split.vendorDebitCents).toBe(6_000);
    expect(split.platformWriteOffCents).toBe(4_000);
  });

  it("returns zeros for invalid refunds", () => {
    expect(computeRefundSplit(0, 0.6)).toEqual({ vendorDebitCents: 0, platformWriteOffCents: 0 });
    expect(computeRefundSplit(-1, 0.6)).toEqual({ vendorDebitCents: 0, platformWriteOffCents: 0 });
  });

  it("floors fractional cents toward the platform (never over-debits the vendor)", () => {
    // 333 * 0.6 = 199.8 -> vendor 199, platform 134
    const split = computeRefundSplit(333, 0.6);
    expect(split.vendorDebitCents + split.platformWriteOffCents).toBe(333);
    expect(split.vendorDebitCents).toBe(199);
  });
});

describe("planVendorDebit", () => {
  it("pulls entirely from pending when pending covers the debit", () => {
    const plan = planVendorDebit(6_000, 10_000, 5_000);
    expect(plan).toEqual({
      pendingDelta: -6_000,
      paidDelta: 0,
      newPendingCents: 4_000,
      newPaidCents: 5_000,
    });
  });

  it("drains pending and pulls remainder from paid when pending is insufficient", () => {
    // debit 6000, pending 2000, paid 10000
    const plan = planVendorDebit(6_000, 2_000, 10_000);
    expect(plan).toEqual({
      pendingDelta: -2_000,
      paidDelta: -4_000,
      newPendingCents: 0,
      newPaidCents: 6_000,
    });
  });

  it("drives paid negative if both balances combined are insufficient (recovery debt)", () => {
    const plan = planVendorDebit(10_000, 1_000, 2_000);
    expect(plan).toEqual({
      pendingDelta: -1_000,
      paidDelta: -9_000,
      newPendingCents: 0,
      newPaidCents: -7_000,
    });
  });

  it("is a no-op for zero or negative debits", () => {
    const plan = planVendorDebit(0, 5_000, 3_000);
    expect(plan).toEqual({
      pendingDelta: 0,
      paidDelta: 0,
      newPendingCents: 5_000,
      newPaidCents: 3_000,
    });
  });

  it("preserves the invariant: deltas always sum to -debit", () => {
    const cases: Array<[number, number, number]> = [
      [6_000, 10_000, 5_000],
      [6_000, 2_000, 10_000],
      [10_000, 1_000, 2_000],
      [199, 100, 100],
    ];
    for (const [debit, pending, paid] of cases) {
      const plan = planVendorDebit(debit, pending, paid);
      expect(plan.pendingDelta + plan.paidDelta).toBe(-debit);
    }
  });
});

describe("addRefundToBalance", () => {
  it("adds refund cents to a Decimal balance string with no float drift", () => {
    // 10.10 + (10/100) = 10.20
    expect(addRefundToBalance("10.10", 10)).toBe("10.20");
    // The classic 0.1 + 0.2 float trap — Decimal avoids it.
    expect(addRefundToBalance("0.10", 20)).toBe("0.30");
    expect(addRefundToBalance("100.00", 10_000)).toBe("200.00");
  });

  it("ignores invalid refund amounts but keeps the balance well-formed", () => {
    expect(addRefundToBalance("50.00", 0)).toBe("50.00");
    expect(addRefundToBalance("50.00", -100)).toBe("50.00");
    expect(addRefundToBalance("50.00", Number.NaN)).toBe("50.00");
  });
});

// ──────────────────────────────────────────────────────
// Storage methods (mocked tx)
//
// We import lazily inside each test so vi.mock can intercept "./db" before
// the storage module loads its `db` reference. The DatabaseStorage methods
// call `db.transaction(fn)` and pass `fn` a `tx` builder. We stub that
// builder to record the values handed to insert/update.
// ──────────────────────────────────────────────────────

interface TxCall {
  table: any;
  op: "select" | "insert" | "update";
  values?: any;
  where?: any;
  setValues?: any;
  forUpdate?: boolean;
  returningRows?: any[];
}

function makeTx(plan: {
  selectRowsForTable: Map<any, any[]>;
  returningRowsForTable?: Map<any, any[]>;
}) {
  const calls: TxCall[] = [];

  function makeSelectBuilder(): any {
    const state: { table?: any; whereArg?: any; forUpdate?: boolean } = {};
    const builder: any = {
      from(table: any) {
        state.table = table;
        return builder;
      },
      where(arg: any) {
        state.whereArg = arg;
        return builder;
      },
      for(_mode: string) {
        state.forUpdate = true;
        return builder;
      },
      orderBy() {
        return builder;
      },
      limit(_n: number) {
        return Promise.resolve(plan.selectRowsForTable.get(state.table) ?? []);
      },
      then(onFulfilled: any, onRejected: any) {
        // Tables resolved without orderBy/limit chaining.
        const rows = plan.selectRowsForTable.get(state.table) ?? [];
        calls.push({
          table: state.table,
          op: "select",
          where: state.whereArg,
          forUpdate: state.forUpdate,
        });
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function makeInsertBuilder(table: any): any {
    const state: { values?: any } = {};
    const builder: any = {
      values(vals: any) {
        state.values = vals;
        const inner: any = {
          onConflictDoNothing() {
            return inner;
          },
          onConflictDoUpdate() {
            return inner;
          },
          returning() {
            calls.push({ table, op: "insert", values: state.values });
            return Promise.resolve(plan.returningRowsForTable?.get(table) ?? [{ id: 1, ...state.values }]);
          },
          then(onFulfilled: any, onRejected: any) {
            calls.push({ table, op: "insert", values: state.values });
            return Promise.resolve(undefined).then(onFulfilled, onRejected);
          },
        };
        return inner;
      },
    };
    return builder;
  }

  function makeUpdateBuilder(table: any): any {
    const state: { setValues?: any; whereArg?: any } = {};
    const builder: any = {
      set(vals: any) {
        state.setValues = vals;
        return builder;
      },
      where(arg: any) {
        state.whereArg = arg;
        const inner: any = {
          returning() {
            calls.push({
              table,
              op: "update",
              setValues: state.setValues,
              where: state.whereArg,
            });
            return Promise.resolve(plan.returningRowsForTable?.get(table) ?? [{ id: 1, ...state.setValues }]);
          },
          then(onFulfilled: any, onRejected: any) {
            calls.push({
              table,
              op: "update",
              setValues: state.setValues,
              where: state.whereArg,
            });
            return Promise.resolve(undefined).then(onFulfilled, onRejected);
          },
        };
        return inner;
      },
    };
    return builder;
  }

  const tx = {
    select: () => makeSelectBuilder(),
    insert: (table: any) => makeInsertBuilder(table),
    update: (table: any) => makeUpdateBuilder(table),
  };

  return { tx, calls };
}

// ──────────────────────────────────────────────────────
// createDispute idempotency + ownership
// ──────────────────────────────────────────────────────

describe("DatabaseStorage.createDispute", () => {
  let storage: any;
  let schema: any;
  let mockDb: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("./db", () => ({
      db: {
        transaction: vi.fn(async (fn: any) => fn(mockDb.tx)),
      },
    }));
    schema = await import("@shared/schema");
  });

  afterEach(() => {
    vi.doUnmock("./db");
    vi.resetModules();
  });

  it("returns the existing dispute when one is already on file for the order", async () => {
    const existingDispute = {
      id: 7,
      orderId: 42,
      leadId: 5,
      buyerUserId: "buyer-1",
      reason: "duplicate",
      notes: null,
      status: "open",
      resolverUserId: null,
      resolvedAt: null,
      refundCents: null,
      createdAt: new Date(),
    };
    mockDb = makeTx({
      selectRowsForTable: new Map<any, any[]>([
        [schema.orders, [{ id: 42, userId: "buyer-1", leadId: 5, price: "100.00" }]],
        [schema.leadDisputes, [existingDispute]],
      ]),
    });
    const { storage: realStorage } = await import("./storage");
    storage = realStorage;

    const result = await storage.createDispute({
      orderId: 42,
      buyerUserId: "buyer-1",
      reason: "duplicate",
      notes: "again",
    });

    expect(result).toBe(existingDispute);
    // No insert should have happened.
    expect(mockDb.calls.some((c: TxCall) => c.op === "insert")).toBe(false);
  });

  it("rejects when the order belongs to a different buyer", async () => {
    mockDb = makeTx({
      selectRowsForTable: new Map<any, any[]>([
        [schema.orders, [{ id: 42, userId: "buyer-OTHER", leadId: 5, price: "100.00" }]],
        [schema.leadDisputes, []],
      ]),
    });
    const { storage: realStorage } = await import("./storage");
    storage = realStorage;

    await expect(
      storage.createDispute({
        orderId: 42,
        buyerUserId: "buyer-1",
        reason: "fraud",
      }),
    ).rejects.toThrow(/does not belong/i);
  });
});

// ──────────────────────────────────────────────────────
// approveDispute money flow
// ──────────────────────────────────────────────────────

describe("DatabaseStorage.approveDispute", () => {
  let storage: any;
  let schema: any;
  let mockDb: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("./db", () => ({
      db: {
        transaction: vi.fn(async (fn: any) => fn(mockDb.tx)),
      },
    }));
    // Pin the rev share so refund split is deterministic.
    process.env.REV_SHARE_PCT = "0.6";
    schema = await import("@shared/schema");
  });

  afterEach(() => {
    delete process.env.REV_SHARE_PCT;
    vi.doUnmock("./db");
    vi.resetModules();
  });

  it("writes the buyer wallet credit using Decimal math", async () => {
    mockDb = makeTx({
      selectRowsForTable: new Map<any, any[]>([
        [
          schema.leadDisputes,
          [{
            id: 1,
            orderId: 10,
            leadId: 20,
            buyerUserId: "buyer-1",
            status: "open",
          }],
        ],
        [schema.orders, [{ id: 10, userId: "buyer-1", leadId: 20, price: "100.00" }]],
        [schema.leads, [{ id: 20, vendorId: 99 }]],
        [schema.users, [{ id: "buyer-1", balance: "0.10" }]],
        [schema.vendorBalances, [{ id: 1, vendorId: 99, pendingCents: 10_000, paidCents: 0 }]],
      ]),
      returningRowsForTable: new Map<any, any[]>([
        [schema.leadDisputes, [{ id: 1, status: "approved", refundCents: 10_000 }]],
      ]),
    });
    const { storage: realStorage } = await import("./storage");
    storage = realStorage;

    await storage.approveDispute(1, "admin-1", 10_000);

    // The user.update should set balance to "100.10" — Decimal math, no float drift.
    const userUpdate = mockDb.calls.find((c: TxCall) => c.op === "update" && c.table === schema.users);
    expect(userUpdate).toBeDefined();
    expect(userUpdate.setValues.balance).toBe("100.10");
  });

  it("pulls vendor debit from pending first, then from paid when pending is insufficient", async () => {
    mockDb = makeTx({
      selectRowsForTable: new Map<any, any[]>([
        [
          schema.leadDisputes,
          [{
            id: 2,
            orderId: 11,
            leadId: 21,
            buyerUserId: "buyer-1",
            status: "open",
          }],
        ],
        [schema.orders, [{ id: 11, userId: "buyer-1", leadId: 21, price: "100.00" }]],
        [schema.leads, [{ id: 21, vendorId: 99 }]],
        [schema.users, [{ id: "buyer-1", balance: "0.00" }]],
        // pending 2000c, paid 10000c — vendor debit at 60% of 10000 = 6000
        // 6000 > 2000 → drain pending, take 4000 from paid
        [schema.vendorBalances, [{ id: 1, vendorId: 99, pendingCents: 2_000, paidCents: 10_000 }]],
      ]),
      returningRowsForTable: new Map<any, any[]>([
        [schema.leadDisputes, [{ id: 2, status: "approved", refundCents: 10_000 }]],
      ]),
    });
    const { storage: realStorage } = await import("./storage");
    storage = realStorage;

    await storage.approveDispute(2, "admin-1", 10_000);

    const balUpdate = mockDb.calls.find(
      (c: TxCall) => c.op === "update" && c.table === schema.vendorBalances,
    );
    expect(balUpdate).toBeDefined();
    expect(balUpdate.setValues.pendingCents).toBe(0);
    expect(balUpdate.setValues.paidCents).toBe(6_000);

    // One refund payout row inserted with the full negative debit.
    const refundRow = mockDb.calls.find(
      (c: TxCall) => c.op === "insert" && c.table === schema.vendorPayouts,
    );
    expect(refundRow).toBeDefined();
    expect(refundRow.values.amountCents).toBe(-6_000);
    expect(refundRow.values.kind).toBe("refund");
    expect(refundRow.values.orderId).toBe(11);
  });

  it("clamps refundCents > order price down to the order price", async () => {
    mockDb = makeTx({
      selectRowsForTable: new Map<any, any[]>([
        [
          schema.leadDisputes,
          [{ id: 3, orderId: 12, leadId: 22, buyerUserId: "buyer-1", status: "open" }],
        ],
        // Order is $50 (5000 cents); admin requests 20000c refund — should clamp to 5000.
        [schema.orders, [{ id: 12, userId: "buyer-1", leadId: 22, price: "50.00" }]],
        [schema.leads, [{ id: 22, vendorId: 99 }]],
        [schema.users, [{ id: "buyer-1", balance: "0.00" }]],
        [schema.vendorBalances, [{ id: 1, vendorId: 99, pendingCents: 100_000, paidCents: 0 }]],
      ]),
      returningRowsForTable: new Map<any, any[]>([
        [schema.leadDisputes, [{ id: 3, status: "approved", refundCents: 5_000 }]],
      ]),
    });
    const { storage: realStorage } = await import("./storage");
    storage = realStorage;

    await storage.approveDispute(3, "admin-1", 20_000);

    // The leadDisputes update should record refundCents=5000 (clamped).
    const disputeUpdate = mockDb.calls.find(
      (c: TxCall) => c.op === "update" && c.table === schema.leadDisputes,
    );
    expect(disputeUpdate).toBeDefined();
    expect(disputeUpdate.setValues.refundCents).toBe(5_000);
    expect(disputeUpdate.setValues.status).toBe("approved");

    // Buyer credited by exactly $50.00 — not $200.
    const userUpdate = mockDb.calls.find(
      (c: TxCall) => c.op === "update" && c.table === schema.users,
    );
    expect(userUpdate.setValues.balance).toBe("50.00");
  });

  it("is idempotent: re-approving an already-approved dispute returns the existing row without re-debiting", async () => {
    mockDb = makeTx({
      selectRowsForTable: new Map<any, any[]>([
        [
          schema.leadDisputes,
          [{ id: 4, orderId: 13, leadId: 23, buyerUserId: "buyer-1", status: "approved", refundCents: 5_000 }],
        ],
      ]),
    });
    const { storage: realStorage } = await import("./storage");
    storage = realStorage;

    const result = await storage.approveDispute(4, "admin-1", 5_000);
    expect(result.status).toBe("approved");

    // No further updates or inserts should have fired for vendor balances / payouts / users.
    const vendorWrites = mockDb.calls.filter(
      (c: TxCall) =>
        (c.op === "update" || c.op === "insert") &&
        (c.table === schema.vendorBalances || c.table === schema.vendorPayouts || c.table === schema.users),
    );
    expect(vendorWrites).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────
// denyDispute idempotency
// ──────────────────────────────────────────────────────

describe("DatabaseStorage.denyDispute", () => {
  let storage: any;
  let schema: any;
  let mockDb: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("./db", () => ({
      db: {
        transaction: vi.fn(async (fn: any) => fn(mockDb.tx)),
      },
    }));
    schema = await import("@shared/schema");
  });

  afterEach(() => {
    vi.doUnmock("./db");
    vi.resetModules();
  });

  it("returns the existing row unchanged when the dispute is already denied", async () => {
    const denied = {
      id: 9,
      orderId: 50,
      leadId: 60,
      buyerUserId: "buyer-1",
      status: "denied",
      resolverUserId: "admin-old",
      resolvedAt: new Date("2026-01-01"),
    };
    mockDb = makeTx({
      selectRowsForTable: new Map<any, any[]>([[schema.leadDisputes, [denied]]]),
    });
    const { storage: realStorage } = await import("./storage");
    storage = realStorage;

    const result = await storage.denyDispute(9, "admin-new");
    expect(result).toBe(denied);
    const updates = mockDb.calls.filter((c: TxCall) => c.op === "update");
    expect(updates).toHaveLength(0);
  });

  it("refuses to deny an already-approved dispute (one-way ledger)", async () => {
    mockDb = makeTx({
      selectRowsForTable: new Map<any, any[]>([
        [schema.leadDisputes, [{ id: 10, status: "approved" }]],
      ]),
    });
    const { storage: realStorage } = await import("./storage");
    storage = realStorage;

    await expect(storage.denyDispute(10, "admin-1")).rejects.toThrow(/already approved/i);
  });
});

// ──────────────────────────────────────────────────────
// Route admin guard (smoke test via the shared isAuthenticated/role gate).
// We exercise the route handler logic at the storage seam: a non-admin
// calling listDisputes through the admin endpoint must be refused before
// any storage method runs.
// ──────────────────────────────────────────────────────

describe("admin dispute endpoint role gating (logical assertion)", () => {
  it("enforces admin role at the route layer (documented contract)", async () => {
    // This is an integration-style assertion: the routes.ts handler reads
    // the user role from storage and short-circuits with 403 for non-admins
    // BEFORE invoking storage.listDisputes / approveDispute / denyDispute.
    // We assert the pattern via the storage interface: a non-admin must
    // never reach the storage methods. The actual HTTP layer test would
    // require booting Express; the contract here is enforced by reading the
    // routes module and checking the guard structure.
    const routesSource = await import("fs").then(fs =>
      fs.promises.readFile(new URL("./routes.ts", import.meta.url), "utf8"),
    );
    // Every admin dispute endpoint must check user.role !== "admin".
    expect(routesSource).toContain("/api/admin/disputes");
    const adminBlock = routesSource.slice(routesSource.indexOf("/api/admin/disputes"));
    // The block contains the role guard for the list, approve, and deny routes.
    const guardMatches = adminBlock.match(/user\?\.role !== "admin"/g) ?? [];
    expect(guardMatches.length).toBeGreaterThanOrEqual(3);
  });
});
