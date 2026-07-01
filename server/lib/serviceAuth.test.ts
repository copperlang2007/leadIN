import { describe, it, expect } from "vitest";
import {
  signServiceRequest,
  verifyServiceRequest,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  NONCE_HEADER,
} from "./serviceAuth";

const SECRET = "test-service-secret";
const NOW = 1_800_000_000_000;

describe("signServiceRequest / verifyServiceRequest", () => {
  it("round-trips a signed request", () => {
    const body = JSON.stringify({ hello: "world" });
    const headers = signServiceRequest(body, SECRET, { timestamp: NOW, nonce: "abc12345" });
    expect(headers[TIMESTAMP_HEADER]).toBe(String(NOW));
    expect(headers[NONCE_HEADER]).toBe("abc12345");
    expect(headers[SIGNATURE_HEADER]).toMatch(/^sha256=[0-9a-f]{64}$/);

    expect(verifyServiceRequest(body, headers, SECRET, { now: NOW })).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const headers = signServiceRequest("original", SECRET, { timestamp: NOW, nonce: "nonce-001" });
    const result = verifyServiceRequest("tampered", headers, SECRET, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad signature");
  });

  it("rejects a wrong secret", () => {
    const headers = signServiceRequest("body", SECRET, { timestamp: NOW, nonce: "nonce-001" });
    const result = verifyServiceRequest("body", headers, "other-secret", { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a stale timestamp beyond the skew window", () => {
    const headers = signServiceRequest("body", SECRET, { timestamp: NOW, nonce: "nonce-001" });
    const result = verifyServiceRequest("body", headers, SECRET, { now: NOW + 10 * 60 * 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale request");
  });

  it("rejects missing headers", () => {
    const result = verifyServiceRequest("body", {}, SECRET, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 503 when no secret is configured", () => {
    const headers = signServiceRequest("body", SECRET, { timestamp: NOW, nonce: "nonce-001" });
    const result = verifyServiceRequest("body", headers, undefined, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("rejects a replayed nonce when a guard is supplied", () => {
    const headers = signServiceRequest("body", SECRET, { timestamp: NOW, nonce: "used-nonce" });
    const result = verifyServiceRequest("body", headers, SECRET, {
      now: NOW,
      seenNonce: (n) => n === "used-nonce",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("replayed nonce");
  });

  it("accepts case-insensitive header keys", () => {
    const body = "body";
    const signed = signServiceRequest(body, SECRET, { timestamp: NOW, nonce: "nonce-001" });
    const upper = {
      "X-LCP-Timestamp": signed[TIMESTAMP_HEADER],
      "X-LCP-Nonce": signed[NONCE_HEADER],
      "X-LCP-Signature": signed[SIGNATURE_HEADER],
    };
    expect(verifyServiceRequest(body, upper, SECRET, { now: NOW })).toEqual({ ok: true });
  });

  it("produces distinct signatures for distinct (nonce, body) inputs", () => {
    const a = signServiceRequest("body", SECRET, { timestamp: NOW, nonce: "nonceaaa" });
    const b = signServiceRequest("xbody", SECRET, { timestamp: NOW, nonce: "noncebbb" });
    expect(a[SIGNATURE_HEADER]).not.toBe(b[SIGNATURE_HEADER]);
  });

  it("rejects a nonce with an illegal charset (defense in depth)", () => {
    // sign refuses to produce a signature for a non-conforming nonce...
    expect(() => signServiceRequest("body", SECRET, { timestamp: NOW, nonce: "has.dot" })).toThrow();
    // ...and verify refuses one supplied directly in the headers.
    const forged = {
      [TIMESTAMP_HEADER]: String(NOW),
      [NONCE_HEADER]: "has.dot",
      [SIGNATURE_HEADER]: "sha256=deadbeef",
    };
    const result = verifyServiceRequest("body", forged, SECRET, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad nonce");
  });
});
