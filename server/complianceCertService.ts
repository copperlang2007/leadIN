// Compliance certificate service — turns the pure Ed25519 primitive
// (complianceCertificate.ts) into a product surface: it builds a PII-free
// certificate payload from a lead, signs it with the platform's private key
// (from env), and lets anyone verify it with the published public key.
//
// Keys are provided via env as PEM (newlines may be "\n"-escaped, which we
// normalize). When no private key is configured, issuance is unavailable
// (callers return 503) but verification still works if a public key is set.

import {
  issueCertificate,
  verifyCertificate,
  type CertificatePayload,
  type SignedCertificate,
} from "./complianceCertificate";

export interface CertifiableLead {
  id: number;
  state: string;
  mediscore?: number | null;
  dncFlagged?: boolean | null;
  tcpaVerifiedAt?: Date | string | null;
  tcpaCertId?: string | null;
  verified?: boolean | null;
}

function normalizePem(pem: string | undefined): string | undefined {
  if (!pem) return undefined;
  // Allow keys stored with literal "\n" in env vars.
  const out = pem.includes("-----BEGIN") ? pem.replace(/\\n/g, "\n") : pem;
  return out.trim() ? out : undefined;
}

export function getPrivateKey(): string | undefined {
  return normalizePem(process.env.COMPLIANCE_CERT_PRIVATE_KEY);
}

export function getPublicKey(): string | undefined {
  return normalizePem(process.env.COMPLIANCE_CERT_PUBLIC_KEY);
}

export function getIssuer(): string {
  return process.env.COMPLIANCE_CERT_ISSUER || "lead-connect-pro";
}

/**
 * Build a PII-free certificate payload from a lead + an audit-trail hash.
 * Pure & deterministic given `issuedAt`/`issuer`.
 */
export function buildCertificatePayload(
  lead: CertifiableLead,
  auditHash: string,
  issuedAt: string,
  issuer: string = getIssuer(),
): CertificatePayload {
  const dncClean = !lead.dncFlagged;
  const tcpaConsent = !!lead.tcpaVerifiedAt || !!lead.tcpaCertId;
  const disclosures = {
    tcpa_consent: tcpaConsent,
    dnc_clean: dncClean,
    vendor_verified: !!lead.verified,
  };
  // "compliant" only when the gating disclosures hold.
  const decision = dncClean && tcpaConsent ? "compliant" : "blocked";

  return {
    v: 1,
    leadId: lead.id,
    auditHash,
    decision,
    disclosures,
    state: lead.state,
    complianceScore: Math.max(0, Math.min(100, Math.round(lead.mediscore ?? 0))),
    issuedAt,
    issuer,
  };
}

export interface IssueResult {
  ok: boolean;
  certificate?: SignedCertificate;
  reason?: string;
}

/** Issue a signed certificate for a lead. Returns ok:false if no key configured. */
export function issueCertificateForLead(lead: CertifiableLead, auditHash: string): IssueResult {
  const privateKey = getPrivateKey();
  if (!privateKey) return { ok: false, reason: "issuance_unavailable_no_private_key" };
  try {
    const payload = buildCertificatePayload(lead, auditHash, new Date().toISOString());
    return { ok: true, certificate: issueCertificate(payload, privateKey) };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "issue_error" };
  }
}

/** Verify a certificate with the configured public key. */
export function verifyWithConfiguredKey(cert: SignedCertificate): { valid: boolean; reason: string } {
  const publicKey = getPublicKey();
  if (!publicKey) return { valid: false, reason: "verification_unavailable_no_public_key" };
  return verifyCertificate(cert, publicKey);
}
