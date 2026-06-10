// Integration test: wallet top-up via creditUserFromStripe.
//
// Exercises the per-session-id idempotency guarantee end-to-end:
//   1. Seed a pending stripe_checkout_sessions row.
//   2. Call creditUserFromStripe once — user balance increments, row
//      transitions to "completed".
//   3. Call creditUserFromStripe a second time with the same session id —
//      balance must NOT change, row stays "completed".
//
// Skipped unless LIVE_DB_TESTS=1 and DATABASE_URL is set.

import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { LIVE, seedUser, seedStripeSession, assertDbReachable } from "./setup.js";
import { db } from "../db";
import { storage } from "../storage";
import { users, stripeCheckoutSessions } from "@shared/schema";

describe.skipIf(!LIVE)("wallet credit flow (live DB)", () => {
  beforeAll(async () => {
    await assertDbReachable();
  });

  it("credits exactly once per stripe session id", async () => {
    const userId = await seedUser();
    const sessionId = await seedStripeSession({ userId });

    const before = await db
      .select({ balance: users.balance })
      .from(users)
      .where(eq(users.id, userId));
    const startBalance = Number(before[0].balance);

    // First call — should credit.
    await storage.creditUserFromStripe(userId, sessionId, 25);
    const afterFirst = await db
      .select({ balance: users.balance })
      .from(users)
      .where(eq(users.id, userId));
    expect(Number(afterFirst[0].balance)).toBe(startBalance + 25);

    // Second call — should be a no-op (idempotency).
    await storage.creditUserFromStripe(userId, sessionId, 25);
    const afterSecond = await db
      .select({ balance: users.balance })
      .from(users)
      .where(eq(users.id, userId));
    expect(Number(afterSecond[0].balance)).toBe(startBalance + 25);

    // Stripe session row should be in "completed" state.
    const [session] = await db
      .select()
      .from(stripeCheckoutSessions)
      .where(eq(stripeCheckoutSessions.stripeSessionId, sessionId));
    expect(session.status).toBe("completed");
  });

  it("distinct session ids credit independently", async () => {
    const userId = await seedUser();
    const session1 = await seedStripeSession({ userId });
    const session2 = await seedStripeSession({ userId });

    await storage.creditUserFromStripe(userId, session1, 10);
    await storage.creditUserFromStripe(userId, session2, 15);

    const [row] = await db
      .select({ balance: users.balance })
      .from(users)
      .where(eq(users.id, userId));
    expect(Number(row.balance)).toBe(25);
  });
});
