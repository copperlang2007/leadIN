// Handler logic for the org-scoped vendor-API-key list/revoke endpoints.
// Extracted from routes.ts so it can be unit-tested without spinning up the
// full app. Both handlers are pure functions over an injected `Deps` bag:
// the request body/params, plus storage + audit dependencies.

export interface VendorKeyRow {
  id: number;
  vendorId: number;
  vendorName: string | null;
  keyPrefix: string;
  active: boolean;
  createdAt: Date | null;
  revokedAt: Date | null;
}

export interface VendorKeyStorage {
  getUserOrgRole(userId: string, orgId: string): Promise<string | null | undefined>;
  listVendorApiKeys(orgId: string): Promise<VendorKeyRow[]>;
  revokeVendorApiKey(keyId: number): Promise<void>;
}

export interface RecordAuditFn {
  (input: {
    actorUserId: string;
    orgId?: string | null;
    action: string;
    targetKind?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

function isOwnerOrAdmin(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export async function listVendorKeysHandler(deps: {
  userId: string;
  orgId: string;
  storage: VendorKeyStorage;
}): Promise<HandlerResult> {
  const role = await deps.storage.getUserOrgRole(deps.userId, deps.orgId);
  if (!isOwnerOrAdmin(role)) {
    return { status: 403, body: { message: "Owner or admin role required" } };
  }
  const keys = await deps.storage.listVendorApiKeys(deps.orgId);
  return { status: 200, body: keys };
}

export async function revokeVendorKeyHandler(deps: {
  userId: string;
  orgId: string;
  rawKeyId: string;
  storage: VendorKeyStorage;
  recordAudit: RecordAuditFn;
}): Promise<HandlerResult> {
  const keyId = parseInt(deps.rawKeyId, 10);
  if (!Number.isFinite(keyId)) {
    return { status: 400, body: { message: "Invalid keyId" } };
  }
  const role = await deps.storage.getUserOrgRole(deps.userId, deps.orgId);
  if (!isOwnerOrAdmin(role)) {
    return { status: 403, body: { message: "Owner or admin role required" } };
  }
  const orgKeys = await deps.storage.listVendorApiKeys(deps.orgId);
  const target = orgKeys.find(k => k.id === keyId);
  if (!target) {
    return { status: 404, body: { message: "Vendor API key not found" } };
  }
  await deps.storage.revokeVendorApiKey(keyId);
  // Audit must NOT throw — defensive .catch on top of the helper's own
  // try/catch.
  deps.recordAudit({
    actorUserId: deps.userId,
    orgId: deps.orgId,
    action: "vendor_key.revoke",
    targetKind: "vendor_key",
    targetId: String(keyId),
    metadata: { keyPrefix: target.keyPrefix },
  }).catch(() => {});
  return { status: 200, body: { ok: true } };
}
