// Unit tests for the vendor-API-key list/revoke handlers extracted from
// routes.ts. We exercise the pure handler functions directly with a mock
// storage interface and a mock recordAudit, so no Express, no live DB, no
// auth boilerplate.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listVendorKeysHandler,
  revokeVendorKeyHandler,
  type VendorKeyRow,
  type VendorKeyStorage,
  type RecordAuditFn,
} from "./vendorKeyRoutes";

function makeKey(overrides: Partial<VendorKeyRow> = {}): VendorKeyRow {
  return {
    id: 1,
    vendorId: 100,
    vendorName: "Acme Leads",
    keyPrefix: "lcp_abc123",
    active: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    revokedAt: null,
    ...overrides,
  };
}

interface MockStorage extends VendorKeyStorage {
  getUserOrgRole: ReturnType<typeof vi.fn>;
  listVendorApiKeys: ReturnType<typeof vi.fn>;
  revokeVendorApiKey: ReturnType<typeof vi.fn>;
}

function makeStorage(opts: {
  role?: string | null;
  keys?: VendorKeyRow[];
} = {}): MockStorage {
  // `role` may be intentionally null; only fall back to "owner" when the
  // caller omits the field entirely.
  const role = "role" in opts ? opts.role : "owner";
  return {
    getUserOrgRole: vi.fn(async () => role),
    listVendorApiKeys: vi.fn(async () => opts.keys ?? []),
    revokeVendorApiKey: vi.fn(async () => undefined),
  };
}

describe("listVendorKeysHandler", () => {
  it("returns 403 when caller is not owner or admin", async () => {
    const storage = makeStorage({ role: "agent" });
    const result = await listVendorKeysHandler({
      userId: "u-1",
      orgId: "org-1",
      storage,
    });
    expect(result.status).toBe(403);
    expect(storage.listVendorApiKeys).not.toHaveBeenCalled();
  });

  it("returns 403 when role lookup yields null", async () => {
    const storage = makeStorage({ role: null });
    const result = await listVendorKeysHandler({
      userId: "u-1",
      orgId: "org-1",
      storage,
    });
    expect(result.status).toBe(403);
  });

  it("returns the keys for owners", async () => {
    const keys = [makeKey(), makeKey({ id: 2, keyPrefix: "lcp_xyz" })];
    const storage = makeStorage({ role: "owner", keys });
    const result = await listVendorKeysHandler({
      userId: "u-1",
      orgId: "org-1",
      storage,
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe(keys);
    expect(storage.listVendorApiKeys).toHaveBeenCalledWith("org-1");
  });

  it("returns the keys for admins", async () => {
    const keys = [makeKey()];
    const storage = makeStorage({ role: "admin", keys });
    const result = await listVendorKeysHandler({
      userId: "u-1",
      orgId: "org-1",
      storage,
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe(keys);
  });
});

describe("revokeVendorKeyHandler", () => {
  let recordAudit: ReturnType<typeof vi.fn>;
  let recordAuditFn: RecordAuditFn;

  beforeEach(() => {
    recordAudit = vi.fn(async () => undefined);
    recordAuditFn = recordAudit as unknown as RecordAuditFn;
  });

  it("returns 400 when keyId is not a number", async () => {
    const storage = makeStorage({ role: "owner" });
    const result = await revokeVendorKeyHandler({
      userId: "u-1",
      orgId: "org-1",
      rawKeyId: "not-a-number",
      storage,
      recordAudit: recordAuditFn,
    });
    expect(result.status).toBe(400);
    expect(storage.revokeVendorApiKey).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns 403 for non-owner/admin roles", async () => {
    const storage = makeStorage({ role: "agent", keys: [makeKey()] });
    const result = await revokeVendorKeyHandler({
      userId: "u-1",
      orgId: "org-1",
      rawKeyId: "1",
      storage,
      recordAudit: recordAuditFn,
    });
    expect(result.status).toBe(403);
    expect(storage.revokeVendorApiKey).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns 404 when the key does not belong to this org", async () => {
    // The org's key list does not contain id=999, so revoking 999 must
    // 404 — this protects against a foreign-org keyId being revoked.
    const storage = makeStorage({
      role: "owner",
      keys: [makeKey({ id: 1 }), makeKey({ id: 2 })],
    });
    const result = await revokeVendorKeyHandler({
      userId: "u-1",
      orgId: "org-1",
      rawKeyId: "999",
      storage,
      recordAudit: recordAuditFn,
    });
    expect(result.status).toBe(404);
    expect(storage.revokeVendorApiKey).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("revokes the key and writes an audit row on success", async () => {
    const target = makeKey({ id: 42, keyPrefix: "lcp_target" });
    const storage = makeStorage({
      role: "owner",
      keys: [makeKey({ id: 1 }), target],
    });
    const result = await revokeVendorKeyHandler({
      userId: "u-1",
      orgId: "org-1",
      rawKeyId: "42",
      storage,
      recordAudit: recordAuditFn,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(storage.revokeVendorApiKey).toHaveBeenCalledWith(42);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      actorUserId: "u-1",
      orgId: "org-1",
      action: "vendor_key.revoke",
      targetKind: "vendor_key",
      targetId: "42",
      metadata: { keyPrefix: "lcp_target" },
    });
  });

  it("still succeeds when audit logging throws (audit must not break the action)", async () => {
    const target = makeKey({ id: 7, keyPrefix: "lcp_fail" });
    const storage = makeStorage({ role: "admin", keys: [target] });
    const throwingAudit: RecordAuditFn = vi.fn(async () => {
      throw new Error("audit DB down");
    });
    const result = await revokeVendorKeyHandler({
      userId: "u-1",
      orgId: "org-1",
      rawKeyId: "7",
      storage,
      recordAudit: throwingAudit,
    });
    expect(result.status).toBe(200);
    expect(storage.revokeVendorApiKey).toHaveBeenCalledWith(7);
  });
});
