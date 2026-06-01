// Privileged-action audit log.
//
// Every privileged admin action writes one append-only row to
// `admin_audit_log`. Reads are exposed via `listAudit` (admin-only at the
// route layer).
//
// Design rules:
//   * `recordAudit` MUST NEVER throw. Audit failures are logged and swallowed;
//     they must not block the underlying action from succeeding.
//   * Callers should still attach a `.catch` for safety, but the helper itself
//     also wraps everything in try/catch.
//   * The DB layer is injected via a thin `AuditStore` interface so tests can
//     run without a live DB.

import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "./db";
import { adminAuditLog, type AdminAuditEntry, type InsertAdminAuditEntry } from "@shared/schema";
import { log } from "./logger";

export interface RecordAuditInput {
  actorUserId: string;
  orgId?: string | null;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListAuditFilters {
  action?: string;
  actorUserId?: string;
  limit?: number;
}

// Minimal DB surface we use — keeps tests honest. The real `db` from drizzle
// satisfies this shape implicitly.
export interface AuditStore {
  insert: typeof defaultDb.insert;
  select: typeof defaultDb.select;
}

let storeRef: AuditStore = defaultDb;

/** Test-only: inject a mock DB. Returns a reset function. */
export function __setAuditStoreForTesting(store: AuditStore): () => void {
  const prev = storeRef;
  storeRef = store;
  return () => {
    storeRef = prev;
  };
}

/**
 * Append a row to admin_audit_log. Never throws — failures are logged.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    const row: InsertAdminAuditEntry = {
      actorUserId: input.actorUserId,
      orgId: input.orgId ?? null,
      action: input.action,
      targetKind: input.targetKind ?? null,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? null) as InsertAdminAuditEntry["metadata"],
    };
    await storeRef.insert(adminAuditLog).values(row);
  } catch (err) {
    // Swallow — auditing must never break the main action.
    log.error("[audit] recordAudit failed", {
      action: input.action,
      actorUserId: input.actorUserId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Read audit entries with optional filters, most recent first.
 * `limit` clamps to [1, 500] with a default of 100.
 */
export async function listAudit(filters: ListAuditFilters = {}): Promise<AdminAuditEntry[]> {
  const limit = clampLimit(filters.limit);
  const conditions = [];
  if (filters.action) conditions.push(eq(adminAuditLog.action, filters.action));
  if (filters.actorUserId) conditions.push(eq(adminAuditLog.actorUserId, filters.actorUserId));

  const whereClause = conditions.length === 0
    ? undefined
    : conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  const query = storeRef
    .select()
    .from(adminAuditLog);

  const filtered = whereClause ? query.where(whereClause) : query;
  return await filtered.orderBy(desc(adminAuditLog.createdAt)).limit(limit);
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || raw === null) return 100;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  if (n < 1) return 1;
  if (n > 500) return 500;
  return Math.floor(n);
}

// Re-export for tests that want to assert on the SQL helpers without
// re-importing drizzle.
export const __internals = { sql, eq, and, desc };
