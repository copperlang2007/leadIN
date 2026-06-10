// Integration test harness.
//
// These tests require a real reachable Postgres at DATABASE_URL plus
// LIVE_DB_TESTS=1. They are skipped silently when either is missing —
// the unit test suite stays green in any environment.
//
// What "integration" means here: we exercise server/storage.ts and
// related modules against a real DB, end-to-end, with the same Drizzle
// schema CI applies. Tests do NOT spin up an Express app — that's a
// separate harness (would need supertest + session cookie wiring).
// Storage-level integration catches the real bugs (DB constraints,
// trigger interactions, advisory-lock semantics, idempotency).
//
// Seeding convention: every test uses unique IDs (timestamps +
// randomness) so concurrent test runs don't collide. We don't truncate
// between tests — orphan rows in a CI scratch DB are harmless and let
// us parallelise eventually.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { users, organizations, vendors, leads, stripeCheckoutSessions } from "@shared/schema";
import { randomBytes } from "crypto";

// LIVE is true when either the env flag is set explicitly, OR the test
// runner was invoked via `npm run test:integration` (which sets
// npm_lifecycle_event). The script-name path avoids needing POSIX-only
// `LIVE_DB_TESTS=1 vitest run` inline assignment in package.json, so the
// command works on Windows shells too.
export const LIVE =
  (process.env.LIVE_DB_TESTS === "1" ||
    process.env.npm_lifecycle_event === "test:integration") &&
  !!process.env.DATABASE_URL;

/** A fresh id suitable for varchar primary keys. */
export function freshId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

/**
 * Throws when the DB is unreachable. Use in `beforeAll` to fail fast
 * before each integration test wastes time hitting timeouts. Skip
 * semantics live on the `describe.skipIf(!LIVE)` block, not here.
 */
export async function assertDbReachable(): Promise<void> {
  await db.execute(sql`SELECT 1`);
}

/** Insert a minimal organization row. Returns the id. */
export async function seedOrg(): Promise<string> {
  const id = freshId("org");
  await db.insert(organizations).values({
    id,
    name: `Test Org ${id}`,
    slug: id,
  });
  return id;
}

/** Insert a minimal user row. */
export async function seedUser(opts: { orgId?: string; role?: string } = {}): Promise<string> {
  const id = freshId("usr");
  await db.insert(users).values({
    id,
    email: `${id}@test.local`,
    firstName: "Test",
    lastName: "User",
    role: opts.role ?? "buyer",
    activeOrgId: opts.orgId ?? null,
  });
  return id;
}

/** Insert a minimal vendor + lead row. Returns the lead id. */
export async function seedLead(opts: { orgId?: string; createdAt?: Date } = {}): Promise<number> {
  // Vendors are referenced from leads; create per-call to keep tests isolated.
  const [vendor] = await db
    .insert(vendors)
    .values({
      name: `vendor-${freshId("v")}`,
    })
    .returning({ id: vendors.id });
  const [lead] = await db
    .insert(leads)
    .values({
      vendorId: vendor.id,
      orgId: opts.orgId ?? null,
      type: "Medicare Advantage",
      source: "test",
      exclusivity: "shared",
      price: "10.00",
      consumerAge: 65,
      state: "CA",
      zipCode: "90001",
      consumerName: "John Doe",
      consumerPhone: "+15555550100",
      consumerEmail: "john@test.local",
      consumerAddress: "1 Main St, Springfield",
      provenance: { stub: true },
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: leads.id });
  return lead.id;
}

/** Insert a pending Stripe checkout session row for wallet flow tests. */
export async function seedStripeSession(opts: {
  userId: string;
  stripeSessionId?: string;
}): Promise<string> {
  const stripeSessionId = opts.stripeSessionId ?? freshId("cs");
  await db.insert(stripeCheckoutSessions).values({
    stripeSessionId,
    userId: opts.userId,
    status: "pending",
    amount: "25.00",
  });
  return stripeSessionId;
}
