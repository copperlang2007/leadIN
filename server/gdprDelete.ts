// GDPR self-serve account deletion.
//
// `deleteAccount(userId)` runs the cascade described in the wave-4 spec
// inside a single DB transaction. If any step throws the whole thing
// rolls back and the user row stays intact.
//
// Step order (also asserted in gdprDelete.test.ts):
//   1. Anonymize consumer PII on every lead the user purchased.
//      Order rows + revenue audit trail are preserved; only PII columns
//      (consumer_name, consumer_phone, consumer_email, consumer_address,
//      session_id) are wiped.
//   2. Delete agent_profile rows (also cascades from user, but we count
//      explicitly so the caller can show row counts).
//   3. Delete saved_lists owned by the user.
//   4. Delete behavioral_events for the user.
//   5. Delete user_profile.
//   6. Owner-only orgs: if the user is the sole `owner` of an org, delete
//      the org (its members, agent_profiles, leads.orgId → set null, etc.
//      cascade via FK). If there are other owners, just remove this user's
//      org_members row.
//   7. Delete the user row last. FK cascades handle anything else still
//      pointing at the user (orders, lead_assignments, etc.).
//
// The DB layer is injected via `GdprStore` so the unit test can run
// without a live Postgres.

import { and, eq, ne, sql } from "drizzle-orm";
import { db as defaultDb } from "./db";
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

export interface DeleteAccountResult {
  deletedRows: Record<string, number>;
}

// Minimal surface used by deleteAccount. Drizzle's real `db` satisfies it.
export interface GdprStore {
  transaction: typeof defaultDb.transaction;
}

let storeRef: GdprStore = defaultDb;

/** Test-only: inject a mock DB. Returns a reset function. */
export function __setGdprStoreForTesting(store: GdprStore): () => void {
  const prev = storeRef;
  storeRef = store;
  return () => {
    storeRef = prev;
  };
}

/**
 * Delete a user and cascade their PII per the GDPR plan.
 * All operations run in one transaction — any failure rolls back.
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  if (!userId || typeof userId !== "string") {
    throw new Error("deleteAccount: userId is required");
  }

  return await storeRef.transaction(async (tx: any) => {
    const deletedRows: Record<string, number> = {
      leadsAnonymized: 0,
      agentProfiles: 0,
      savedLists: 0,
      behavioralEvents: 0,
      userProfiles: 0,
      orgsDeleted: 0,
      orgMemberships: 0,
      users: 0,
    };

    // 1. Anonymize PII in purchased leads.
    // Parameterized via drizzle — `userId` is bound, never interpolated.
    const anonResult = await tx
      .update(leads)
      .set({
        consumerName: null,
        consumerPhone: null,
        consumerEmail: null,
        consumerAddress: null,
        sessionId: null,
      })
      .where(eq(leads.purchasedBy, userId))
      .returning({ id: leads.id });
    deletedRows.leadsAnonymized = anonResult.length;

    // 2. agent_profiles
    const agentRows = await tx
      .delete(agentProfiles)
      .where(eq(agentProfiles.userId, userId))
      .returning({ id: agentProfiles.id });
    deletedRows.agentProfiles = agentRows.length;

    // 3. saved_lists (saved_list_items cascade via FK from savedLists.id)
    const savedListRows = await tx
      .delete(savedLists)
      .where(eq(savedLists.ownerUserId, userId))
      .returning({ id: savedLists.id });
    deletedRows.savedLists = savedListRows.length;

    // 4. behavioral_events
    const eventRows = await tx
      .delete(behavioralEvents)
      .where(eq(behavioralEvents.userId, userId))
      .returning({ id: behavioralEvents.id });
    deletedRows.behavioralEvents = eventRows.length;

    // 5. user_profile
    const profileRows = await tx
      .delete(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .returning({ id: userProfiles.id });
    deletedRows.userProfiles = profileRows.length;

    // 6. Organizations: walk every org the user owns. If they are the only
    // owner left, delete the org; otherwise just drop their membership.
    const ownedRows: { orgId: string }[] = await tx
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, "owner")));

    for (const { orgId } of ownedRows) {
      const otherOwners: { id: number }[] = await tx
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.orgId, orgId),
            eq(orgMembers.role, "owner"),
            ne(orgMembers.userId, userId),
          ),
        );

      if (otherOwners.length === 0) {
        // Delete the org. FK cascades handle org_members, agent_profiles;
        // leads.orgId / orders.orgId / vendor_api_keys.orgId are `set null`.
        const orgDel = await tx
          .delete(organizations)
          .where(eq(organizations.id, orgId))
          .returning({ id: organizations.id });
        deletedRows.orgsDeleted += orgDel.length;
      }
    }

    // Drop any remaining memberships (including non-owner roles, and owner
    // rows for orgs where another owner exists).
    const memberRows = await tx
      .delete(orgMembers)
      .where(eq(orgMembers.userId, userId))
      .returning({ id: orgMembers.id });
    deletedRows.orgMemberships = memberRows.length;

    // 7. The user row last. FK cascades on remaining tables fire here.
    const userRows = await tx
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    deletedRows.users = userRows.length;

    return { deletedRows };
  });
}

// Re-export drizzle helpers for tests that want to assert without re-importing.
export const __internals = { sql, eq, and, ne };
