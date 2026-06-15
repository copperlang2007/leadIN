// Per-provider native CRM webhook signature verification.
//
// Sits on top of the shared HMAC guard in crmWebhookAuth.ts. When a
// provider-native verifier passes, we accept the webhook and skip the
// shared check — the native scheme is strictly stronger because it
// uses provider-issued secrets. When a provider-native verifier
// returns "not-supported" (e.g. Salesforce, which needs X.509 cert
// verification we haven't implemented yet), the caller falls back to
// the shared HMAC guard.
//
// References:
//   - HubSpot v3: https://developers.hubspot.com/docs/api/webhooks/validating-requests
//   - GHL:       https://highlevel.stoplight.io/docs/integrations/x-wh-signature
//   - Pipedrive: https://developers.pipedrive.com/docs/api/v1/Webhooks
//   - Salesforce: needs X.509 cert from the connected app — not in scope

import crypto from "crypto";

export type NativeVerifyResult =
  | { ok: true; verified: true; provider: string }
  | { ok: false; status: number; reason: string; provider: string }
  | { ok: true; verified: false; reason: "not-supported"; provider: string }
  | { ok: true; verified: false; reason: "secret-not-configured"; provider: string };

interface VerifierContext {
  rawBody: Buffer | string | undefined;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
  env?: NodeJS.ProcessEnv;
}

function headerOf(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

function ensureRawBody(rawBody: Buffer | string | undefined, provider: string): Buffer | NativeVerifyResult {
  if (rawBody === undefined) {
    return { ok: false, status: 500, reason: "raw-body-unavailable", provider };
  }
  return typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
}

function timingSafeEq(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── HubSpot V3 ──────────────────────────────────────────────────────
// HMAC-SHA256 over (method + url + body + timestamp) signed with the
// App Client Secret. Timestamp must be within 5 minutes of now to
// reject replays.
//
// Headers:
//   X-HubSpot-Signature-v3: base64 of the HMAC
//   X-HubSpot-Request-Timestamp: epoch ms as a string
export function verifyHubspot(ctx: VerifierContext): NativeVerifyResult {
  const env = ctx.env ?? process.env;
  const secret = env.HUBSPOT_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: true, verified: false, reason: "secret-not-configured", provider: "hubspot" };
  }

  const sig = headerOf(ctx.headers, "x-hubspot-signature-v3");
  const tsHeader = headerOf(ctx.headers, "x-hubspot-request-timestamp");
  if (!sig || !tsHeader) {
    return { ok: false, status: 401, reason: "missing-signature", provider: "hubspot" };
  }

  const ts = parseInt(tsHeader, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 401, reason: "malformed-timestamp", provider: "hubspot" };
  }
  // Reject if the request is older than 5 minutes (HubSpot's documented window).
  const ageMs = Math.abs(Date.now() - ts);
  if (ageMs > 5 * 60 * 1000) {
    return { ok: false, status: 401, reason: "timestamp-too-old", provider: "hubspot" };
  }

  const bodyOrErr = ensureRawBody(ctx.rawBody, "hubspot");
  if (!(bodyOrErr instanceof Buffer)) return bodyOrErr;

  // V3 message = method + url + body + timestamp
  const message = Buffer.concat([
    Buffer.from(ctx.method.toUpperCase(), "utf8"),
    Buffer.from(ctx.url, "utf8"),
    bodyOrErr,
    Buffer.from(tsHeader, "utf8"),
  ]);
  const expected = crypto.createHmac("sha256", secret).update(message).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64");
  } catch {
    return { ok: false, status: 401, reason: "malformed-signature", provider: "hubspot" };
  }
  if (!timingSafeEq(provided, expected)) {
    return { ok: false, status: 401, reason: "signature-mismatch", provider: "hubspot" };
  }
  return { ok: true, verified: true, provider: "hubspot" };
}

// ─── GoHighLevel (GHL) ───────────────────────────────────────────────
// HMAC-SHA256 of the raw body, signed with GHL_WEBHOOK_SECRET.
// Header: x-wh-signature, hex-encoded.
export function verifyGhl(ctx: VerifierContext): NativeVerifyResult {
  const env = ctx.env ?? process.env;
  const secret = env.GHL_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: true, verified: false, reason: "secret-not-configured", provider: "ghl" };
  }

  const sig = headerOf(ctx.headers, "x-wh-signature");
  if (!sig) {
    return { ok: false, status: 401, reason: "missing-signature", provider: "ghl" };
  }

  const cleaned = sig.startsWith("sha256=") ? sig.slice(7) : sig;
  if (!/^[0-9a-f]+$/i.test(cleaned)) {
    return { ok: false, status: 401, reason: "malformed-signature", provider: "ghl" };
  }

  const bodyOrErr = ensureRawBody(ctx.rawBody, "ghl");
  if (!(bodyOrErr instanceof Buffer)) return bodyOrErr;

  const expected = crypto.createHmac("sha256", secret).update(bodyOrErr).digest("hex");

  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(cleaned, "hex");
    expectedBuf = Buffer.from(expected, "hex");
  } catch {
    return { ok: false, status: 401, reason: "malformed-signature", provider: "ghl" };
  }
  if (!timingSafeEq(providedBuf, expectedBuf)) {
    return { ok: false, status: 401, reason: "signature-mismatch", provider: "ghl" };
  }
  return { ok: true, verified: true, provider: "ghl" };
}

// ─── Pipedrive ───────────────────────────────────────────────────────
// Pipedrive supports HTTP Basic Auth on the webhook URL (operator
// configures the credentials in the Pipedrive UI; receiver validates
// the Authorization header against PIPEDRIVE_WEBHOOK_USER /
// PIPEDRIVE_WEBHOOK_PASS).
export function verifyPipedrive(ctx: VerifierContext): NativeVerifyResult {
  const env = ctx.env ?? process.env;
  const user = env.PIPEDRIVE_WEBHOOK_USER;
  const pass = env.PIPEDRIVE_WEBHOOK_PASS;
  if (!user || !pass) {
    return { ok: true, verified: false, reason: "secret-not-configured", provider: "pipedrive" };
  }

  const auth = headerOf(ctx.headers, "authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return { ok: false, status: 401, reason: "missing-basic-auth", provider: "pipedrive" };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
  } catch {
    return { ok: false, status: 401, reason: "malformed-basic-auth", provider: "pipedrive" };
  }
  const expected = `${user}:${pass}`;
  const a = Buffer.from(decoded, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (!timingSafeEq(a, b)) {
    return { ok: false, status: 401, reason: "basic-auth-mismatch", provider: "pipedrive" };
  }
  return { ok: true, verified: true, provider: "pipedrive" };
}

// ─── Salesforce ──────────────────────────────────────────────────────
// Salesforce platform events sign via an X.509 certificate from the
// connected app. Verifying that requires fetching the public cert from
// Salesforce and validating the digital signature, which is a bigger
// design (cert rotation, caching, etc.). For now we report
// "not-supported" so the caller falls back to the shared HMAC guard.
export function verifySalesforce(_ctx: VerifierContext): NativeVerifyResult {
  return { ok: true, verified: false, reason: "not-supported", provider: "salesforce" };
}

// ─── Dispatcher ──────────────────────────────────────────────────────
export function verifyByProvider(
  provider: string,
  ctx: VerifierContext,
): NativeVerifyResult {
  switch (provider) {
    case "hubspot":   return verifyHubspot(ctx);
    case "ghl":       return verifyGhl(ctx);
    case "pipedrive": return verifyPipedrive(ctx);
    case "salesforce":return verifySalesforce(ctx);
    default:
      return { ok: true, verified: false, reason: "not-supported", provider };
  }
}
