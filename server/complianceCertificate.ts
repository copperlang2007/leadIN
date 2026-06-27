// Verifiable compliance certificate — the "provably compliant lead" primitive.
//
// Every lead/connect the platform sells can ship with a cryptographically
// signed, PII-FREE receipt proving it cleared the compliance gate (TCPA
// consent, recording, SOA ordering, DNC, calling hours, etc.). Crucially the
// signature is Ed25519 (asymmetric): a buyer verifies authenticity with the
// platform's PUBLIC key — they never need to trust the seller or hold a shared
// secret. That turns "trust me, it's compliant" into "verify it yourself," a
// category-defining differentiator versus commodity Medicare lead sellers and a
// natural marketplace standard.
//
// Built on Node's native crypto (Ed25519) — no new dependency. Pure functions
// so issuance/verification are fully unit-testable.

import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "crypto";

export interface CertificatePayload {
  v: 1;
  leadId: number;
  /** Hash (e.g. SHA-256) of the tamper-evident audit trail / recording ref. */
  auditHash: string;
  /** Gate outcome, e.g. "compliant" | "blocked". */
  decision: string;
  /** Disclosure booleans — which compliance checks passed. PII-free. */
  disclosures: Record<string, boolean>;
  /** Consumer state (for licensing/jurisdiction), not PII. */
  state: string;
  /** Compliance score 0..100. */
  complianceScore: number;
  issuedAt: string; // ISO timestamp
  issuer: string; // platform/org identifier
}

export interface SignedCertificate {
  payload: CertificatePayload;
  alg: "ed25519";
  signature: string; // base64
}

export interface VerificationResult {
  valid: boolean;
  reason: string;
}

// Keys that must never appear in a certificate payload (defense-in-depth so a
// future caller can't accidentally leak PII into a signed, shareable artifact).
const PII_PATTERNS: Array<[string, RegExp]> = [
  ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ["phone", /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/],
  ["ssn", /\b\d{3}-\d{2}-\d{4}\b/],
];

/**
 * Throws if a payload appears to contain PII. A certificate is meant to be
 * shared with buyers, so it must be safe by construction.
 */
export function assertPiiFree(payload: CertificatePayload): void {
  // Only scan free-text-ish fields; numeric leadId/score are exempt.
  const scanned = JSON.stringify({
    auditHash: payload.auditHash,
    decision: payload.decision,
    disclosures: payload.disclosures,
    state: payload.state,
    issuer: payload.issuer,
  });
  for (const [name, re] of PII_PATTERNS) {
    if (re.test(scanned)) {
      throw new Error(`Certificate payload appears to contain ${name} — refusing to sign PII.`);
    }
  }
}

/** Deterministic JSON with recursively sorted keys, so signatures are stable. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/** Generate an Ed25519 keypair as PEM strings (for setup / tests). */
export function generateCertificateKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/**
 * Issue a signed certificate. `privateKeyPem` is the platform's Ed25519 private
 * key (kept server-side); only the corresponding public key is published.
 */
export function issueCertificate(payload: CertificatePayload, privateKeyPem: string): SignedCertificate {
  assertPiiFree(payload);
  const message = Buffer.from(canonicalize(payload), "utf8");
  const signature = cryptoSign(null, message, privateKeyPem).toString("base64");
  return { payload, alg: "ed25519", signature };
}

/**
 * Verify a certificate against the platform's PUBLIC key. Returns a structured
 * result rather than throwing, so buyer-side verification UIs stay simple.
 */
export function verifyCertificate(cert: SignedCertificate, publicKeyPem: string): VerificationResult {
  if (!cert || cert.alg !== "ed25519") return { valid: false, reason: "unsupported_algorithm" };
  if (!cert.signature) return { valid: false, reason: "missing_signature" };
  try {
    const message = Buffer.from(canonicalize(cert.payload), "utf8");
    const ok = cryptoVerify(null, message, publicKeyPem, Buffer.from(cert.signature, "base64"));
    return ok ? { valid: true, reason: "ok" } : { valid: false, reason: "signature_mismatch" };
  } catch (e: any) {
    return { valid: false, reason: `verify_error: ${e?.message ?? "unknown"}` };
  }
}
