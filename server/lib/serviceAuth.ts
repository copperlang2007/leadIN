// Service-to-service request authentication (LCP <-> MedicareCallForge).
//
// Two first-party services on private networking don't need mTLS's cert
// lifecycle; per ADR-0002 we sign each request with a shared HMAC over
// `timestamp.nonce.body` and verify with a short freshness window plus an
// optional replay guard. Mirrors the CRM webhook HMAC pattern
// (server/lib/crmWebhookAuth.ts).
//
// The functions are pure w.r.t. clock/randomness (both injectable) so the
// sign→verify contract is unit-testable without wall-clock flakiness.

import crypto from "crypto";

export const TIMESTAMP_HEADER = "x-lcp-timestamp";
export const NONCE_HEADER = "x-lcp-nonce";
export const SIGNATURE_HEADER = "x-lcp-signature";

// Requests whose timestamp is further than this from "now" are rejected —
// bounds both clock skew and how long a captured request stays replayable.
export const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

// Nonce charset/length guard (defense-in-depth on top of the injective
// encoding below). Random hex nonces satisfy this; a caller that forwards a
// user-controlled string not matching this is rejected rather than signed.
export const NONCE_RE = /^[A-Za-z0-9_-]{8,128}$/;

// Injective encoding. Joining fields with a delimiter that can also appear
// inside a field (e.g. `.` in a nonce) is ambiguous — a different (nonce, body)
// split could produce byte-identical HMAC input and therefore the same
// signature. JSON.stringify of a fixed-shape tuple quotes/escapes each field so
// the mapping from (timestamp, nonce, body) to bytes is one-to-one.
// NOTE: the MCF-side signer MUST use this exact canonical form.
function computeSignature(secret: string, timestamp: string, nonce: string, body: string): string {
  const canonical = JSON.stringify([timestamp, nonce, body]);
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export type SignedHeaders = Record<string, string>;

/**
 * Build auth headers for an outbound service request. `timestamp`/`nonce` are
 * injectable for tests; in production they default to now + a random nonce.
 */
export function signServiceRequest(
  body: string,
  secret: string,
  opts: { timestamp?: number; nonce?: string } = {},
): SignedHeaders {
  const timestamp = String(opts.timestamp ?? Date.now());
  const nonce = opts.nonce ?? crypto.randomBytes(16).toString("hex");
  if (!NONCE_RE.test(nonce)) {
    throw new Error("invalid nonce: must match [A-Za-z0-9_-]{8,128}");
  }
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: `sha256=${computeSignature(secret, timestamp, nonce, body)}`,
  };
}

export type VerifyResult = { ok: true } | { ok: false; status: number; reason: string };

/**
 * Verify an inbound signed service request. Pure w.r.t. clock via `now`.
 *  - secret unset          → 503 (service auth not configured)
 *  - missing/short headers  → 401
 *  - timestamp out of skew  → 401 (stale/replay)
 *  - signature mismatch     → 401
 *  - `seenNonce(nonce)` true → 401 (replayed nonce), if a guard is supplied
 */
export function verifyServiceRequest(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string | undefined,
  opts: { now?: number; maxSkewMs?: number; seenNonce?: (nonce: string) => boolean } = {},
): VerifyResult {
  if (!secret) return { ok: false, status: 503, reason: "service auth not configured" };

  // Node/Express lowercases header keys, but normalize defensively so callers
  // passing raw mixed-case headers still verify.
  const lower: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const read = (k: string) => {
    const v = lower[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const timestamp = read(TIMESTAMP_HEADER);
  const nonce = read(NONCE_HEADER);
  const provided = read(SIGNATURE_HEADER);
  if (!timestamp || !nonce || !provided) {
    return { ok: false, status: 401, reason: "missing auth headers" };
  }
  if (!NONCE_RE.test(nonce)) {
    return { ok: false, status: 401, reason: "bad nonce" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, status: 401, reason: "bad timestamp" };
  const now = opts.now ?? Date.now();
  const maxSkew = opts.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs(now - ts) > maxSkew) return { ok: false, status: 401, reason: "stale request" };

  const expected = `sha256=${computeSignature(secret, timestamp, nonce, rawBody)}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, reason: "bad signature" };
  }

  if (opts.seenNonce?.(nonce)) return { ok: false, status: 401, reason: "replayed nonce" };
  return { ok: true };
}
