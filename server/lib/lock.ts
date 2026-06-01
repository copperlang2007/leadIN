// Postgres advisory-lock helpers. Two flavours:
//
//   1. `withAdvisoryLock(key, fn)` — try-lock, run `fn` if we got the lock,
//      release on exit. Returns `null` if someone else held the lock.
//      Cron jobs use this to ensure only one instance fires per schedule.
//
//   2. `withTxAdvisoryLock(tx, key, fn)` — transaction-scoped exclusive
//      lock. Auto-released at commit. Routing engine uses this to
//      serialize per-org assignment decisions.
//
// Keys are 64-bit integers in PG. We hash strings into the int64 space.

import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

// Stable hash of a string into a signed int64 (the range pg_*advisory_lock
// uses). Determinism matters — every node must derive the same key.
export function lockKey(name: string): bigint {
  const h = crypto.createHash("sha256").update(name).digest();
  // Take the first 8 bytes as a signed BigInt.
  const high = h.readBigInt64BE(0);
  return high;
}

// Try to acquire a session-scoped advisory lock. If we got it, run `fn`,
// then release. If someone else held it, return null without running.
export async function withAdvisoryLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = lockKey(name);
  const [row] = await db.execute<{ ok: boolean }>(
    sql`SELECT pg_try_advisory_lock(${sql.raw(key.toString())}) AS ok`,
  ) as any as Array<{ ok: boolean }>;
  const rows = Array.isArray(row) ? row : (row as any)?.rows ?? [row];
  const acquired = rows?.[0]?.ok === true;
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${sql.raw(key.toString())})`);
  }
}

// Transaction-scoped exclusive lock — auto-released on commit/rollback.
// Use inside `db.transaction(async (tx) => withTxAdvisoryLock(tx, key, ...))`.
export async function withTxAdvisoryLock<T>(
  tx: { execute: (q: any) => Promise<any> },
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = lockKey(name);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(key.toString())})`);
  return await fn();
}
