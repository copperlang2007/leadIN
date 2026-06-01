import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { parseCookieHeader, verifySignedSid, extractSessionId } from "./websocket";

// Helper: produce the same signed cookie value `express-session` would write.
function signSid(sid: string, secret: string): string {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(sid)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${sid}.${sig}`;
}

describe("parseCookieHeader", () => {
  it("returns an empty map for undefined or empty input", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
  });

  it("parses a single cookie", () => {
    expect(parseCookieHeader("connect.sid=abc")).toEqual({ "connect.sid": "abc" });
  });

  it("parses multiple cookies and trims whitespace", () => {
    expect(parseCookieHeader("a=1; b=2;  c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("URL-decodes values when possible", () => {
    expect(parseCookieHeader("k=s%3Aabc.sig")).toEqual({ k: "s:abc.sig" });
  });

  it("skips parts without an '='", () => {
    expect(parseCookieHeader("a=1; noequals; b=2")).toEqual({ a: "1", b: "2" });
  });
});

describe("verifySignedSid", () => {
  const secret = "test-secret";
  const sid = "BXr2-Nq7qPABCDEF1234567890";

  it("returns the sid when the signature is valid", () => {
    const cookie = signSid(sid, secret);
    expect(verifySignedSid(cookie, secret)).toBe(sid);
  });

  it("rejects a forged cookie with no signature prefix", () => {
    expect(verifySignedSid("anything", secret)).toBeNull();
  });

  it("rejects a cookie that lacks the 's:' prefix", () => {
    expect(verifySignedSid(`${sid}.deadbeef`, secret)).toBeNull();
  });

  it("rejects a cookie with a forged signature", () => {
    expect(verifySignedSid(`s:${sid}.forgedsignature`, secret)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const cookie = signSid(sid, "other-secret");
    expect(verifySignedSid(cookie, secret)).toBeNull();
  });

  it("rejects when no sid portion exists before the dot", () => {
    expect(verifySignedSid("s:.sig", secret)).toBeNull();
  });

  it("rejects an empty / undefined value", () => {
    expect(verifySignedSid(undefined, secret)).toBeNull();
    expect(verifySignedSid("", secret)).toBeNull();
  });
});

describe("extractSessionId", () => {
  const secret = "test-secret";
  const sid = "abc123XYZ";

  it("returns the sid for a request carrying a valid signed cookie", () => {
    const cookie = `connect.sid=${encodeURIComponent(signSid(sid, secret))}`;
    const req = { headers: { cookie } } as any;
    expect(extractSessionId(req, secret)).toBe(sid);
  });

  it("returns null when no cookie header is present", () => {
    const req = { headers: {} } as any;
    expect(extractSessionId(req, secret)).toBeNull();
  });

  it("returns null when the cookie header has no connect.sid entry", () => {
    const req = { headers: { cookie: "other=value" } } as any;
    expect(extractSessionId(req, secret)).toBeNull();
  });

  it("returns null for a forged connect.sid value", () => {
    const req = { headers: { cookie: "connect.sid=anything" } } as any;
    expect(extractSessionId(req, secret)).toBeNull();
  });

  it("returns null for a valid-looking but tampered signed value", () => {
    const cookie = `connect.sid=${encodeURIComponent(`s:${sid}.tampered`)}`;
    const req = { headers: { cookie } } as any;
    expect(extractSessionId(req, secret)).toBeNull();
  });
});
