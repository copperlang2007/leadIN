import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyTrustedFormCert } from "./trustedForm";

const CERT_URL = "https://cert.trustedform.com/abc123token";

describe("verifyTrustedFormCert", () => {
  const originalKey = process.env.TRUSTEDFORM_API_KEY;

  beforeEach(() => {
    process.env.TRUSTEDFORM_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalKey === undefined) {
      delete process.env.TRUSTEDFORM_API_KEY;
    } else {
      process.env.TRUSTEDFORM_API_KEY = originalKey;
    }
  });

  it("returns ok:false when API key is missing", async () => {
    delete process.env.TRUSTEDFORM_API_KEY;
    const result = await verifyTrustedFormCert(CERT_URL);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns ok+certId for a fresh cert", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ cert: { token: "abc123token", age_in_seconds: 3600 } }),
    });

    const result = await verifyTrustedFormCert(CERT_URL);
    expect(result.ok).toBe(true);
    expect(result.certId).toBe("abc123token");
    expect(result.source).toBe("trustedform");

    // Confirm Basic auth uses `:<API_KEY>` convention
    const call = (fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://api.trustedform.com/cert/abc123token.json");
    const auth = call[1].headers.Authorization as string;
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    expect(decoded).toBe(":test-key");
  });

  it("returns ok:false when the cert is older than 90 days", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        cert: { token: "abc123token", age_in_seconds: 100 * 24 * 3600 },
      }),
    });

    const result = await verifyTrustedFormCert(CERT_URL);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too old/i);
  });

  it("returns ok:false when the API responds with non-OK status", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    const result = await verifyTrustedFormCert(CERT_URL);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/404/);
  });

  it("swallows network errors gracefully", async () => {
    (fetch as any).mockRejectedValueOnce(new Error("ECONNRESET"));

    const result = await verifyTrustedFormCert(CERT_URL);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNRESET/);
  });

  it("rejects malformed cert URLs without calling the API", async () => {
    const result = await verifyTrustedFormCert("not-a-url");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/extract cert id/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns ok:false when response is missing the cert envelope", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const result = await verifyTrustedFormCert(CERT_URL);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing cert/i);
  });
});
