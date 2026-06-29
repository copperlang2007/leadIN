// Admin user-management guard logic.
//
// Harvested from the `leadmarket` sibling repo as part of the consolidation
// into this app (see docs/adr/0001-repo-consolidation-strategy.md). The role
// set is adapted to this app's platform model — top-level `users.role` is
// "user" | "admin" (org-level "owner"/"agent" roles live in `org_members` and
// are not touched here). The validation is pure so it can be unit-tested
// independently of HTTP/storage; the route handler owns the DB I/O.

export const ASSIGNABLE_ROLES = ["user", "admin"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(role: string): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

export type RoleChangeCheck =
  | { ok: true }
  | { ok: false; status: number; message: string };

/**
 * Validate a platform role change before it is applied.
 * Guards, in order:
 * - 400 if the requested role is not assignable.
 * - 400 if an admin tries to remove their own admin role (self-demotion).
 * - 400 if the change would remove the last remaining admin.
 */
export function validateRoleChange(params: {
  actorId: string;
  targetId: string;
  newRole: string;
  targetCurrentRole: string;
  adminCount: number;
}): RoleChangeCheck {
  const { actorId, targetId, newRole, targetCurrentRole, adminCount } = params;

  if (!isAssignableRole(newRole)) {
    return {
      ok: false,
      status: 400,
      message: `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`,
    };
  }

  const isDemotion = targetCurrentRole === "admin" && newRole !== "admin";

  if (isDemotion && targetId === actorId) {
    return { ok: false, status: 400, message: "Admins cannot remove their own admin role" };
  }

  if (isDemotion && adminCount <= 1) {
    return { ok: false, status: 400, message: "Cannot remove the last admin" };
  }

  return { ok: true };
}
