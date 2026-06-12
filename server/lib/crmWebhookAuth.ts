// CRM inbound webhook authentication.
//
// Shuts the unsigned-webhook hole that lets any attacker forge a
// `closed-won` deal against a known order and inflate an agent's
// reputation. Until each provider's bespoke signature scheme lands
// (HubSpot v3, Salesforce cert, etc.), we gate the endpoint on a
// shared HMAC: the operator sets `CRM_WEBHOOK_SECRET`, the sending
// CRM (via outgoing-webhook config or a proxy) signs `body` with
// HMAC-SHA256 and sends `X-LCP-Signature: sha256=<hex>`.
//
// When the secret is unset we keep the dev / E2E pass-through (with a
// one-time warning) so the existing integration suite stays green.
// In production, the prod-env validator already flags missing secrets
// — see server/lib/envValidation.ts. A follow-up will add per-provider
// native signature verification on top of this guard.

import crypto from "crypto";

const SIG_HEADER = "x-lcp-signature";
let warnedAboutMissingSecret = false;

export type VerifyResult =
  | { ok: true; verified: boolean; reason?: string }
  | { ok: false; status: number; reason: string };

/**
 * Verify the X-LCP-Signature header against `CRM_WEBHOOK_SECRET`.
 *
 *  - secret unset                  → ok: true, verified: false (pass-through, dev only)
 *  - secret set + rawBody missing  → ok: false, 500 (server-side middleware misconfig)
 *  - secret set + header missing   → ok: false, 401
 *  - secret set + header bad       → ok: false, 401
 *  - secret set + header valid     → ok: true, verified: true
 *
 * `rawBody` must be the exact bytes the CRM signed. Re-serialising
 * `req.body` is unsafe — JSON.stringify can change key order, whitespace,
 * and numeric formatting, which silently breaks HMAC verification.
 * Callers must pass through the buffer populated by express.json's
 * `verify` callback (see server/index.ts).
 */
export function verifyCrmWebhook(
  rawBody: Buffer | string | undefined,
  headers: Record<string, string | string[] | undefined>,
  secret = process.env.CRM_WEBHOOK_SECRET,
): VerifyResult {
  if (!secret || secret.length === 0) {
    if (!warnedAboutMissingSecret) {
      warnedAboutMissingSecret = true;
      console.warn(
        "[crm-webhook] CRM_WEBHOOK_SECRET unset — accepting unsigned webhooks. This is fine for dev/E2E; in production the prod-env validator will require it before boot.",
      );
    }
    return { ok: true, verified: false, reason: "no-secret-configured" };
  }

  // Secret is set, so we MUST verify against the exact bytes the CRM signed.
  // If express.json's verify callback didn't populate rawBody (route mounted
  // without the body parser, or a non-JSON content type), refuse — silently
  // re-serialising req.body would produce different bytes (key order,
  // whitespace, numeric formatting) and signature verification would always
  // fail with confusing 401s. 500 surfaces it as a server misconfig instead.
  if (rawBody === undefined) {
    return { ok: false, status: 500, reason: "raw-body-unavailable" };
  }

  const raw = headers[SIG_HEADER];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  if (!provided || typeof provided !== "string") {
    return { ok: false, status: 401, reason: "missing-signature" };
  }

  // Accept either "sha256=<hex>" (GitHub-style) or bare hex — vendors differ.
  const cleaned = provided.startsWith("sha256=") ? provided.slice(7) : provided;
  if (!/^[0-9a-f]+$/i.test(cleaned)) {
    return { ok: false, status: 401, reason: "malformed-signature" };
  }

  const bodyBuf = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = crypto.createHmac("sha256", secret).update(bodyBuf).digest("hex");

  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(cleaned, "hex");
    expectedBuf = Buffer.from(expected, "hex");
  } catch {
    return { ok: false, status: 401, reason: "malformed-signature" };
  }

  if (providedBuf.length !== expectedBuf.length) {
    return { ok: false, status: 401, reason: "signature-mismatch" };
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, status: 401, reason: "signature-mismatch" };
  }
  return { ok: true, verified: true };
}

/** Test-only reset for the "warned" sentinel. */
export function __resetCrmWebhookAuthForTests(): void {
  warnedAboutMissingSecret = false;
}
