import { describe, it, expect } from "vitest";
import { validateRoleChange, isAssignableRole, ASSIGNABLE_ROLES } from "./adminUsers";

describe("isAssignableRole", () => {
  it("accepts the known platform roles", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(isAssignableRole(role)).toBe(true);
    }
  });

  it("rejects unknown roles (incl. org-level roles)", () => {
    expect(isAssignableRole("owner")).toBe(false);
    expect(isAssignableRole("agent")).toBe(false);
    expect(isAssignableRole("superuser")).toBe(false);
    expect(isAssignableRole("")).toBe(false);
  });
});

describe("validateRoleChange", () => {
  const base = {
    actorId: "admin-1",
    targetId: "user-2",
    newRole: "admin",
    targetCurrentRole: "user",
    adminCount: 2,
  };

  it("allows promoting a user to admin", () => {
    expect(validateRoleChange(base)).toEqual({ ok: true });
  });

  it("allows demoting another admin when others remain", () => {
    expect(
      validateRoleChange({ ...base, newRole: "user", targetCurrentRole: "admin", adminCount: 2 }),
    ).toEqual({ ok: true });
  });

  it("rejects an unknown role with 400", () => {
    const result = validateRoleChange({ ...base, newRole: "owner" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("blocks an admin from demoting themselves", () => {
    const result = validateRoleChange({
      ...base,
      actorId: "admin-1",
      targetId: "admin-1",
      newRole: "user",
      targetCurrentRole: "admin",
      adminCount: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/own admin role/);
  });

  it("blocks removing the last admin", () => {
    const result = validateRoleChange({
      ...base,
      actorId: "admin-1",
      targetId: "admin-2",
      newRole: "user",
      targetCurrentRole: "admin",
      adminCount: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/last admin/);
  });

  it("does not treat a no-op admin→admin change as a demotion", () => {
    expect(
      validateRoleChange({
        ...base,
        targetId: "admin-1",
        actorId: "admin-1",
        newRole: "admin",
        targetCurrentRole: "admin",
        adminCount: 1,
      }),
    ).toEqual({ ok: true });
  });
});
