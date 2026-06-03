// Unit tests for deleteAccount. The DB is mocked via __setGdprStoreForTesting
// so we can drive an in-memory tx and assert the exact order of operations,
// rollback behaviour, and that PII anonymization is parameterized.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  agentProfiles,
  behavioralEvents,
  leads,
  orgMembers,
  organizations,
  savedLists,
  userProfiles,
  users,
} from "@shared/schema";
import {
  deleteAccount,
  __setGdprStoreForTesting,
  type GdprStore,
} from "./gdprDelete";

interface Op {
  kind: "update" | "delete" | "select";
  table: unknown;
  // For update: the values payload (so we can verify parameterized PII clear).
  values?: Record<string, unknown>;
  // The where AST drizzle hands us (opaque) — we just assert presence.
  where?: unknown;
  set?: Record<string, unknown>;
}

interface MockOpts {
  /** Owner rows returned for the user's owned-org query. */
  ownedOrgs?: { orgId: string }[];
  /** For each org id, the other-owners returned by the count query. */
  otherOwnersByOrg?: Record<string, { id: number }[]>;
  /** Throw on this many-th op (1-based) to simulate a failure. */
  throwOnOpIndex?: number;
  /** Throw a particular error message. */
  throwError?: string;
  /** Row counts returned by .returning() for each kind of table. */
  returningCounts?: Map<unknown, number>;
}

function makeMockStore(opts: MockOpts = {}) {
  const ops: Op[] = [];
  const returningCounts = opts.returningCounts ?? new Map();
  // Track per-org other-owner lookups so the test can verify each branch.
  const otherOwnerLookups: string[] = [];

  // selectsForOwnedOrgs is the first `.select().from(orgMembers).where(...)`
  // call (initial owned-org query). After that, every .select() on orgMembers
  // is an "other owners" lookup.
  let ownedOrgSelectCalled = false;

  function makeReturning<T>(rows: T[]) {
    return Promise.resolve(rows);
  }

  function buildSelectChain() {
    const op: Op = { kind: "select", table: undefined };
    const builder: any = {
      from(table: unknown) {
        op.table = table;
        return builder;
      },
      where(arg: unknown) {
        op.where = arg;
        // If we're querying orgMembers and ownedOrgSelect hasn't fired yet,
        // this is the owned-org query.
        if (op.table === orgMembers) {
          if (!ownedOrgSelectCalled) {
            ownedOrgSelectCalled = true;
            ops.push(op);
            maybeThrow();
            return Promise.resolve(opts.ownedOrgs ?? []);
          }
          // Subsequent select on orgMembers → other-owners lookup. We can't
          // peek into the AST so we resolve in declaration order: pop from
          // a queue keyed on declaration index.
          const idx = otherOwnerLookups.length;
          const orgId = (opts.ownedOrgs ?? [])[idx]?.orgId;
          otherOwnerLookups.push(orgId ?? "?");
          ops.push(op);
          maybeThrow();
          return Promise.resolve(
            (orgId && opts.otherOwnersByOrg?.[orgId]) ?? [],
          );
        }
        ops.push(op);
        maybeThrow();
        return Promise.resolve([]);
      },
    };
    return builder;
  }

  function maybeThrow() {
    if (opts.throwOnOpIndex && ops.length === opts.throwOnOpIndex) {
      throw new Error(opts.throwError ?? "simulated tx failure");
    }
  }

  const tx: any = {
    select() {
      return buildSelectChain();
    },
    update(table: unknown) {
      const op: Op = { kind: "update", table };
      return {
        set(values: Record<string, unknown>) {
          op.values = values;
          return {
            where(arg: unknown) {
              op.where = arg;
              return {
                returning() {
                  ops.push(op);
                  maybeThrow();
                  const count = returningCounts.get(table) ?? 0;
                  return makeReturning(
                    Array.from({ length: count }, (_, i) => ({ id: i + 1 })),
                  );
                },
              };
            },
          };
        },
      };
    },
    delete(table: unknown) {
      const op: Op = { kind: "delete", table };
      return {
        where(arg: unknown) {
          op.where = arg;
          return {
            returning() {
              ops.push(op);
              maybeThrow();
              const count = returningCounts.get(table) ?? 0;
              return makeReturning(
                Array.from({ length: count }, (_, i) => ({ id: i + 1 })),
              );
            },
          };
        },
      };
    },
  };

  const transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
    try {
      return await fn(tx);
    } catch (err) {
      // Simulated rollback — we just rethrow. Caller asserts on the error.
      throw err;
    }
  });

  const store = { transaction } as unknown as GdprStore;
  return { store, ops, transaction, otherOwnerLookups };
}

describe("deleteAccount", () => {
  let reset: (() => void) | undefined;

  afterEach(() => {
    reset?.();
    reset = undefined;
    vi.restoreAllMocks();
  });

  it("executes the steps in the spec-mandated order", async () => {
    const { store, ops } = makeMockStore({
      returningCounts: new Map<unknown, number>([
        [leads, 3],
        [agentProfiles, 1],
        [savedLists, 2],
        [behavioralEvents, 11],
        [userProfiles, 1],
        [orgMembers, 0],
        [users, 1],
      ]),
    });
    reset = __setGdprStoreForTesting(store);

    const result = await deleteAccount("u-1");

    // Expected sequence:
    //  1. update leads (anonymize)
    //  2. delete agent_profiles
    //  3. delete saved_lists
    //  4. delete behavioral_events
    //  5. delete user_profiles
    //  6. select org_members (owned orgs query)
    //  7. delete org_members (drop memberships)
    //  8. delete users
    const tables = ops.map((o) => `${o.kind}:${tableName(o.table)}`);
    expect(tables).toEqual([
      "update:leads",
      "delete:agent_profiles",
      "delete:saved_lists",
      "delete:behavioral_events",
      "delete:user_profiles",
      "select:org_members",
      "delete:org_members",
      "delete:users",
    ]);

    expect(result.deletedRows).toMatchObject({
      leadsAnonymized: 3,
      agentProfiles: 1,
      savedLists: 2,
      behavioralEvents: 11,
      userProfiles: 1,
      orgsDeleted: 0,
      orgMemberships: 0,
      users: 1,
    });
  });

  it("deletes orgs the user solely owns and leaves shared-owner orgs alone", async () => {
    const { store, ops } = makeMockStore({
      ownedOrgs: [{ orgId: "org-solo" }, { orgId: "org-shared" }],
      otherOwnersByOrg: {
        "org-solo": [],
        "org-shared": [{ id: 99 }],
      },
      returningCounts: new Map<unknown, number>([
        [leads, 0],
        [agentProfiles, 0],
        [savedLists, 0],
        [behavioralEvents, 0],
        [userProfiles, 0],
        [organizations, 1], // only org-solo gets deleted
        [orgMembers, 2],
        [users, 1],
      ]),
    });
    reset = __setGdprStoreForTesting(store);

    const result = await deleteAccount("u-1");

    const sequence = ops.map((o) => `${o.kind}:${tableName(o.table)}`);
    // The owned-org select kicks off the org branch; we then see two
    // other-owner selects, exactly one delete on organizations
    // (for the solo-owned org), and finally the membership cleanup.
    expect(sequence).toEqual([
      "update:leads",
      "delete:agent_profiles",
      "delete:saved_lists",
      "delete:behavioral_events",
      "delete:user_profiles",
      "select:org_members", // owned orgs query
      "select:org_members", // other-owners for org-solo
      "delete:organizations", // org-solo is solo → deleted
      "select:org_members", // other-owners for org-shared
      // (no delete on organizations for org-shared)
      "delete:org_members",
      "delete:users",
    ]);

    expect(result.deletedRows.orgsDeleted).toBe(1);
  });

  it("PII anonymization clears every consumer-PII column and is parameterized", async () => {
    const { store, ops } = makeMockStore({
      returningCounts: new Map<unknown, number>([[leads, 4]]),
    });
    reset = __setGdprStoreForTesting(store);

    await deleteAccount("u-42");

    const updateOp = ops.find(
      (o) => o.kind === "update" && o.table === leads,
    );
    expect(updateOp).toBeDefined();
    // Exactly these fields are nulled — proves consumer PII is wiped and
    // no extra columns are touched.
    expect(updateOp!.values).toEqual({
      consumerName: null,
      consumerPhone: null,
      consumerEmail: null,
      consumerAddress: null,
      sessionId: null,
    });
    // A drizzle where AST is provided — so the userId flows in as a bound
    // parameter rather than being concatenated into raw SQL.
    expect(updateOp!.where).toBeDefined();
    // Drizzle SQL chunks expose a `queryChunks` / `getSQL` shape, never a
    // user-supplied raw string. We just sanity-check it's not a string.
    expect(typeof updateOp!.where).not.toBe("string");
  });

  it("rolls back when an inner step throws", async () => {
    // Throw on the 3rd op (saved_lists delete). The transaction wrapper
    // simulates rollback by rethrowing — the users table delete must never
    // be reached.
    const { store, ops } = makeMockStore({
      throwOnOpIndex: 3,
      throwError: "saved_lists exploded",
      returningCounts: new Map<unknown, number>([
        [leads, 1],
        [agentProfiles, 0],
        [savedLists, 5],
        [users, 1],
      ]),
    });
    reset = __setGdprStoreForTesting(store);

    await expect(deleteAccount("u-9")).rejects.toThrow("saved_lists exploded");

    // We got as far as 3 ops, then aborted. Users delete must NOT be present.
    const tables = ops.map((o) => tableName(o.table));
    expect(tables).not.toContain("users");
    expect(tables.length).toBe(3);
  });

  it("rejects when userId is missing or non-string", async () => {
    const { store } = makeMockStore();
    reset = __setGdprStoreForTesting(store);

    await expect(deleteAccount("" as string)).rejects.toThrow(/userId is required/);
    // @ts-expect-error — runtime guard
    await expect(deleteAccount(null)).rejects.toThrow(/userId is required/);
    // @ts-expect-error — runtime guard
    await expect(deleteAccount(undefined)).rejects.toThrow(/userId is required/);
  });

  it("returns row counts the route layer can echo back", async () => {
    const { store } = makeMockStore({
      returningCounts: new Map<unknown, number>([
        [leads, 7],
        [agentProfiles, 1],
        [savedLists, 3],
        [behavioralEvents, 42],
        [userProfiles, 1],
        [orgMembers, 2],
        [users, 1],
      ]),
    });
    reset = __setGdprStoreForTesting(store);

    const { deletedRows } = await deleteAccount("u-x");

    expect(deletedRows).toEqual({
      leadsAnonymized: 7,
      agentProfiles: 1,
      savedLists: 3,
      behavioralEvents: 42,
      userProfiles: 1,
      orgsDeleted: 0,
      orgMemberships: 2,
      users: 1,
    });
  });
});

// Resolve the schema table object back to its name for readable assertions.
function tableName(table: unknown): string {
  if (table === leads) return "leads";
  if (table === agentProfiles) return "agent_profiles";
  if (table === savedLists) return "saved_lists";
  if (table === behavioralEvents) return "behavioral_events";
  if (table === userProfiles) return "user_profiles";
  if (table === orgMembers) return "org_members";
  if (table === organizations) return "organizations";
  if (table === users) return "users";
  return "<unknown>";
}
