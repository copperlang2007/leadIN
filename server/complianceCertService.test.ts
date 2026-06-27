import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildCertificatePayload,
  issueCertificateForLead,
  verifyWithConfiguredKey,
  getPrivateKey,
  type CertifiableLead,
} from "./complianceCertService";
import { generateCertificateKeypair, verifyCertificate } from "./complianceCertificate";

const lead: CertifiableLead = {
  id: 7,
  state: "TX",
  mediscore: 92,
  dncFlagged: false,
  tcpaVerifiedAt: new Date("2026-06-01T00:00:00Z"),
  verified: true,
};

describe("buildCertificatePayload", () => {
  it("marks a clean lead compliant with correct disclosures", () => {
    const p = buildCertificatePayload(lead, "sha256:abc", "2026-06-27T00:00:00Z", "lcp");
    expect(p.decision).toBe("compliant");
    expect(p.disclosures).toEqual({ tcpa_consent: true, dnc_clean: true, vendor_verified: true });
    expect(p.complianceScore).toBe(92);
    expect(p.state).toBe("TX");
    expect(p.issuer).toBe("lcp");
  });

  it("marks a DNC-flagged lead blocked", () => {
    const p = buildCertificatePayload({ ...lead, dncFlagged: true }, "h", "2026-06-27T00:00:00Z");
    expect(p.decision).toBe("blocked");
    expect(p.disclosures.dnc_clean).toBe(false);
  });

  it("marks a no-consent lead blocked", () => {
    const p = buildCertificatePayload(
      { ...lead, tcpaVerifiedAt: null, tcpaCertId: null },
      "h",
      "2026-06-27T00:00:00Z",
    );
    expect(p.decision).toBe("blocked");
    expect(p.disclosures.tcpa_consent).toBe(false);
  });

  it("clamps complianceScore to 0..100", () => {
    expect(buildCertificatePayload({ ...lead, mediscore: 250 }, "h", "t").complianceScore).toBe(100);
    expect(buildCertificatePayload({ ...lead, mediscore: null }, "h", "t").complianceScore).toBe(0);
  });
});

describe("issue + verify with env keys", () => {
  const saved = { priv: process.env.COMPLIANCE_CERT_PRIVATE_KEY, pub: process.env.COMPLIANCE_CERT_PUBLIC_KEY };
  beforeEach(() => {
    const { publicKey, privateKey } = generateCertificateKeypair();
    process.env.COMPLIANCE_CERT_PRIVATE_KEY = privateKey;
    process.env.COMPLIANCE_CERT_PUBLIC_KEY = publicKey;
  });
  afterEach(() => {
    if (saved.priv === undefined) delete process.env.COMPLIANCE_CERT_PRIVATE_KEY;
    else process.env.COMPLIANCE_CERT_PRIVATE_KEY = saved.priv;
    if (saved.pub === undefined) delete process.env.COMPLIANCE_CERT_PUBLIC_KEY;
    else process.env.COMPLIANCE_CERT_PUBLIC_KEY = saved.pub;
  });

  it("issues a cert that verifies with the configured public key", () => {
    const result = issueCertificateForLead(lead, "sha256:audit");
    expect(result.ok).toBe(true);
    expect(verifyWithConfiguredKey(result.certificate!)).toEqual({ valid: true, reason: "ok" });
  });

  it("issued cert also verifies against the public key directly", () => {
    const result = issueCertificateForLead(lead, "sha256:audit");
    expect(verifyCertificate(result.certificate!, process.env.COMPLIANCE_CERT_PUBLIC_KEY!).valid).toBe(true);
  });

  it("normalizes escaped-newline PEM keys", () => {
    process.env.COMPLIANCE_CERT_PRIVATE_KEY = (process.env.COMPLIANCE_CERT_PRIVATE_KEY as string).replace(/\n/g, "\\n");
    expect(getPrivateKey()).toContain("-----BEGIN");
    const result = issueCertificateForLead(lead, "h");
    expect(result.ok).toBe(true);
  });
});

describe("graceful degradation without keys", () => {
  const saved = { priv: process.env.COMPLIANCE_CERT_PRIVATE_KEY, pub: process.env.COMPLIANCE_CERT_PUBLIC_KEY };
  beforeEach(() => {
    delete process.env.COMPLIANCE_CERT_PRIVATE_KEY;
    delete process.env.COMPLIANCE_CERT_PUBLIC_KEY;
  });
  afterEach(() => {
    if (saved.priv !== undefined) process.env.COMPLIANCE_CERT_PRIVATE_KEY = saved.priv;
    if (saved.pub !== undefined) process.env.COMPLIANCE_CERT_PUBLIC_KEY = saved.pub;
  });

  it("issuance returns ok:false when no private key", () => {
    const r = issueCertificateForLead(lead, "h");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no_private_key/);
  });

  it("verification returns invalid when no public key", () => {
    const r = verifyWithConfiguredKey({ payload: {} as any, alg: "ed25519", signature: "x" });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/no_public_key/);
  });
});
