import { describe, it, expect } from "vitest";
import {
  issueCertificate,
  verifyCertificate,
  generateCertificateKeypair,
  canonicalize,
  assertPiiFree,
  type CertificatePayload,
} from "./complianceCertificate";

function payload(over: Partial<CertificatePayload> = {}): CertificatePayload {
  return {
    v: 1,
    leadId: 42,
    auditHash: "sha256:abc123def456",
    decision: "compliant",
    disclosures: { tcpa_consent: true, recording_started: true, soa_before_specifics: true, dnc_clean: true },
    state: "TX",
    complianceScore: 98,
    issuedAt: "2026-06-27T00:00:00.000Z",
    issuer: "lead-connect-pro",
    ...over,
  };
}

describe("canonicalize", () => {
  it("is order-independent for object keys", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });
  it("distinguishes different values", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });
});

describe("issue + verify", () => {
  it("a freshly issued certificate verifies against the public key", () => {
    const { publicKey, privateKey } = generateCertificateKeypair();
    const cert = issueCertificate(payload(), privateKey);
    expect(cert.alg).toBe("ed25519");
    expect(verifyCertificate(cert, publicKey)).toEqual({ valid: true, reason: "ok" });
  });

  it("verification is stable regardless of payload key order (canonicalized)", () => {
    const { publicKey, privateKey } = generateCertificateKeypair();
    const cert = issueCertificate(payload(), privateKey);
    // Re-build payload with shuffled key order
    const shuffled = { ...cert, payload: { issuer: cert.payload.issuer, ...cert.payload } as any };
    expect(verifyCertificate(shuffled, publicKey).valid).toBe(true);
  });

  it("fails when the payload is tampered with after signing", () => {
    const { publicKey, privateKey } = generateCertificateKeypair();
    const cert = issueCertificate(payload(), privateKey);
    const tampered = { ...cert, payload: { ...cert.payload, decision: "blocked" } };
    expect(verifyCertificate(tampered, publicKey)).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("fails when a disclosure flag is flipped", () => {
    const { publicKey, privateKey } = generateCertificateKeypair();
    const cert = issueCertificate(payload(), privateKey);
    const tampered = {
      ...cert,
      payload: { ...cert.payload, disclosures: { ...cert.payload.disclosures, dnc_clean: false } },
    };
    expect(verifyCertificate(tampered, publicKey).valid).toBe(false);
  });

  it("fails verification under a different public key", () => {
    const a = generateCertificateKeypair();
    const b = generateCertificateKeypair();
    const cert = issueCertificate(payload(), a.privateKey);
    expect(verifyCertificate(cert, b.publicKey).valid).toBe(false);
  });

  it("rejects an unsupported algorithm or missing signature", () => {
    const { publicKey } = generateCertificateKeypair();
    expect(verifyCertificate({ payload: payload(), alg: "hmac" as any, signature: "x" }, publicKey).valid).toBe(false);
    expect(verifyCertificate({ payload: payload(), alg: "ed25519", signature: "" }, publicKey).valid).toBe(false);
  });
});

describe("assertPiiFree", () => {
  it("passes a clean payload", () => {
    expect(() => assertPiiFree(payload())).not.toThrow();
  });
  it("throws if an email leaks into the payload", () => {
    expect(() => assertPiiFree(payload({ issuer: "contact me at a@b.com" }))).toThrow(/email/);
  });
  it("throws if a phone number leaks into the payload", () => {
    expect(() => assertPiiFree(payload({ decision: "compliant 555-123-4567" }))).toThrow(/phone/);
  });
  it("issueCertificate refuses to sign PII", () => {
    const { privateKey } = generateCertificateKeypair();
    expect(() => issueCertificate(payload({ issuer: "a@b.com" }), privateKey)).toThrow(/PII/);
  });
});
