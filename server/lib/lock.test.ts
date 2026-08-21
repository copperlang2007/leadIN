import { describe, it, expect, vi, beforeEach } from "vitest";

// `withAdvisoryLock` only touches the DB through `db.execute`. Mock it so the
// tests can pin the exact result shapes drivers hand back.
const execute = vi.fn();
vi.mock("../db", () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));

import { withAdvisoryLock, lockKey } from "./lock";

// node-postgres returns a `Result` object — rows under `.rows`, and the object
// itself is NOT iterable. Array-destructuring it throws
// "(intermediate value) is not iterable", which previously crashed the process
// at boot. Older drizzle releases returned the bare row array instead, so both
// shapes have to keep working.
function pgResult(rows: unknown[]) {
  return { command: "SELECT", rowCount: rows.length, oid: null, rows, fields: [] };
}

describe("lockKey", () => {
  it("is deterministic and stays inside the signed int64 range", () => {
    const a = lockKey("cron:email-digest");
    expect(lockKey("cron:email-digest")).toBe(a);
    expect(a).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(a).toBeLessThan(2n ** 63n);
  });

  it("separates distinct names", () => {
    expect(lockKey("seo-bootstrap")).not.toBe(lockKey("cms-bootstrap"));
  });
});

describe("withAdvisoryLock", () => {
  beforeEach(() => execute.mockReset());

  it("runs the body and releases when the driver returns a pg Result", async () => {
    execute
      .mockResolvedValueOnce(pgResult([{ ok: true }]))
      .mockResolvedValueOnce(pgResult([{ pg_advisory_unlock: true }]));

    const fn = vi.fn(async () => "done");
    await expect(withAdvisoryLock("job", fn)).resolves.toBe("done");
    expect(fn).toHaveBeenCalledOnce();
    // Two queries: try-lock, then unlock.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("runs the body when the driver returns a bare row array", async () => {
    execute.mockResolvedValueOnce([{ ok: true }]).mockResolvedValueOnce([]);

    const fn = vi.fn(async () => 42);
    await expect(withAdvisoryLock("job", fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("skips the body and does not unlock when another instance holds the lock", async () => {
    execute.mockResolvedValueOnce(pgResult([{ ok: false }]));

    const fn = vi.fn(async () => "should not run");
    await expect(withAdvisoryLock("job", fn)).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
    // Only the try-lock query — releasing a lock we never took would be wrong.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("treats an empty result as not acquired instead of throwing", async () => {
    execute.mockResolvedValueOnce(pgResult([]));

    const fn = vi.fn(async () => "should not run");
    await expect(withAdvisoryLock("job", fn)).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("releases the lock even when the body throws", async () => {
    execute
      .mockResolvedValueOnce(pgResult([{ ok: true }]))
      .mockResolvedValueOnce(pgResult([]));

    await expect(
      withAdvisoryLock("job", async () => {
        throw new Error("body blew up");
      }),
    ).rejects.toThrow("body blew up");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
