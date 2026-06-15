import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  verifyHubspot,
  verifyGhl,
  verifyPipedrive,
  verifySalesforce,
  verifyByProvider,
} from "./crmNativeAuth";

const BODY = Buffer.from(JSON.stringify({ event: "deal.won", id: "abc" }));
const HUBSPOT_SECRET = "hubspot-app-client-secret";
const GHL_SECRET = "ghl-shared-secret";

function signHubspot(secret: string, method: string, url: string, body: Buffer, ts: number): string {
  const message = Buffer.concat([
    Buffer.from(method.toUpperCase(), "utf8"),
    Buffer.from(url, "utf8"),
    body,
    Buffer.from(String(ts), "utf8"),
  ]);
  return crypto.createHmac("sha256", secret).update(message).digest("base64");
}

function signGhl(secret: string, body: Buffer): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHubspot — V3 (method+url+body+timestamp)", () => {
  const METHOD = "POST";
  const URL = "/api/crm/webhook/hubspot";

  it("returns secret-not-configured when HUBSPOT_WEBHOOK_SECRET is unset", () => {
    const r = verifyHubspot({
      rawBody: BODY,
      headers: {},
      method: METHOD,
      url: URL,
      env: {} as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: false, reason: "secret-not-configured", provider: "hubspot" });
  });

  it("accepts a valid signature within the timestamp window", () => {
    const ts = Date.now();
    const sig = signHubspot(HUBSPOT_SECRET, METHOD, URL, BODY, ts);
    const r = verifyHubspot({
      rawBody: BODY,
      headers: {
        "x-hubspot-signature-v3": sig,
        "x-hubspot-request-timestamp": String(ts),
      },
      method: METHOD,
      url: URL,
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: true, provider: "hubspot" });
  });

  it("rejects when missing signature header", () => {
    const r = verifyHubspot({
      rawBody: BODY,
      headers: { "x-hubspot-request-timestamp": String(Date.now()) },
      method: METHOD,
      url: URL,
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "missing-signature" });
  });

  it("rejects when missing timestamp header", () => {
    const ts = Date.now();
    const sig = signHubspot(HUBSPOT_SECRET, METHOD, URL, BODY, ts);
    const r = verifyHubspot({
      rawBody: BODY,
      headers: { "x-hubspot-signature-v3": sig },
      method: METHOD,
      url: URL,
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "missing-signature" });
  });

  it("rejects when timestamp is > 5 minutes old (replay defence)", () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const sig = signHubspot(HUBSPOT_SECRET, METHOD, URL, BODY, ts);
    const r = verifyHubspot({
      rawBody: BODY,
      headers: {
        "x-hubspot-signature-v3": sig,
        "x-hubspot-request-timestamp": String(ts),
      },
      method: METHOD,
      url: URL,
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "timestamp-too-old" });
  });

  it("rejects future-dated timestamps beyond the 30s skew tolerance", () => {
    // Far-future timestamp — an attacker setting a fixed time ahead to
    // extend their replay window. Old Math.abs check would have accepted
    // up to +5min; tightened to +30s skew only.
    const ts = Date.now() + 2 * 60 * 1000;
    const sig = signHubspot(HUBSPOT_SECRET, METHOD, URL, BODY, ts);
    const r = verifyHubspot({
      rawBody: BODY,
      headers: {
        "x-hubspot-signature-v3": sig,
        "x-hubspot-request-timestamp": String(ts),
      },
      method: METHOD,
      url: URL,
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "timestamp-in-future" });
  });

  it("accepts timestamps within the 30s future skew (clock drift between sender/receiver)", () => {
    // Just-barely-future — legitimate clock drift case. Must still pass.
    const ts = Date.now() + 5 * 1000;
    const sig = signHubspot(HUBSPOT_SECRET, METHOD, URL, BODY, ts);
    const r = verifyHubspot({
      rawBody: BODY,
      headers: {
        "x-hubspot-signature-v3": sig,
        "x-hubspot-request-timestamp": String(ts),
      },
      method: METHOD,
      url: URL,
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: true });
  });

  it("rejects when the signature is correct but the body has been tampered with", () => {
    const ts = Date.now();
    const sig = signHubspot(HUBSPOT_SECRET, METHOD, URL, BODY, ts);
    const tamperedBody = Buffer.from(JSON.stringify({ event: "deal.won", id: "DIFFERENT" }));
    const r = verifyHubspot({
      rawBody: tamperedBody,
      headers: {
        "x-hubspot-signature-v3": sig,
        "x-hubspot-request-timestamp": String(ts),
      },
      method: METHOD,
      url: URL,
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "signature-mismatch" });
  });

  it("500s when rawBody is missing despite secret being configured", () => {
    const ts = Date.now();
    const r = verifyHubspot({
      rawBody: undefined,
      headers: {
        "x-hubspot-signature-v3": "ZmFrZQ==",
        "x-hubspot-request-timestamp": String(ts),
      },
      method: METHOD,
      url: URL,
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 500, reason: "raw-body-unavailable" });
  });
});

describe("verifyGhl — x-wh-signature HMAC-SHA256", () => {
  it("returns secret-not-configured when GHL_WEBHOOK_SECRET is unset", () => {
    const r = verifyGhl({
      rawBody: BODY,
      headers: {},
      method: "POST",
      url: "/x",
      env: {} as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: false, reason: "secret-not-configured", provider: "ghl" });
  });

  it("accepts a valid hex signature", () => {
    const sig = signGhl(GHL_SECRET, BODY);
    const r = verifyGhl({
      rawBody: BODY,
      headers: { "x-wh-signature": sig },
      method: "POST",
      url: "/x",
      env: { GHL_WEBHOOK_SECRET: GHL_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: true, provider: "ghl" });
  });

  it("accepts sha256=<hex> prefix style too", () => {
    const sig = `sha256=${signGhl(GHL_SECRET, BODY)}`;
    const r = verifyGhl({
      rawBody: BODY,
      headers: { "x-wh-signature": sig },
      method: "POST",
      url: "/x",
      env: { GHL_WEBHOOK_SECRET: GHL_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toBe(true);
  });

  it("rejects on tampered body", () => {
    const sig = signGhl(GHL_SECRET, BODY);
    const r = verifyGhl({
      rawBody: Buffer.from("different"),
      headers: { "x-wh-signature": sig },
      method: "POST",
      url: "/x",
      env: { GHL_WEBHOOK_SECRET: GHL_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "signature-mismatch" });
  });

  it("rejects odd-length hex (Buffer.from(hex) silently truncates without this guard)", () => {
    const sig = signGhl(GHL_SECRET, BODY);
    // Drop one trailing char — without the even-length guard, Buffer.from
    // would silently truncate and we could end up comparing a shortened
    // buffer against an equally-truncated expected.
    const truncated = sig.slice(0, -1);
    const r = verifyGhl({
      rawBody: BODY,
      headers: { "x-wh-signature": truncated },
      method: "POST",
      url: "/x",
      env: { GHL_WEBHOOK_SECRET: GHL_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "malformed-signature" });
  });
});

describe("verifyPipedrive — Basic Auth", () => {
  it("returns secret-not-configured when user/pass unset", () => {
    const r = verifyPipedrive({
      rawBody: BODY,
      headers: {},
      method: "POST",
      url: "/x",
      env: {} as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: false, reason: "secret-not-configured", provider: "pipedrive" });
  });

  it("accepts a valid Basic header", () => {
    const cred = Buffer.from("alice:s3cret").toString("base64");
    const r = verifyPipedrive({
      rawBody: BODY,
      headers: { authorization: `Basic ${cred}` },
      method: "POST",
      url: "/x",
      env: {
        PIPEDRIVE_WEBHOOK_USER: "alice",
        PIPEDRIVE_WEBHOOK_PASS: "s3cret",
      } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: true, provider: "pipedrive" });
  });

  it("rejects on wrong password (timing-safe)", () => {
    const cred = Buffer.from("alice:wrong").toString("base64");
    const r = verifyPipedrive({
      rawBody: BODY,
      headers: { authorization: `Basic ${cred}` },
      method: "POST",
      url: "/x",
      env: {
        PIPEDRIVE_WEBHOOK_USER: "alice",
        PIPEDRIVE_WEBHOOK_PASS: "s3cret",
      } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "basic-auth-mismatch" });
  });

  it("rejects when Authorization header is missing", () => {
    const r = verifyPipedrive({
      rawBody: BODY,
      headers: {},
      method: "POST",
      url: "/x",
      env: {
        PIPEDRIVE_WEBHOOK_USER: "alice",
        PIPEDRIVE_WEBHOOK_PASS: "s3cret",
      } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: false, status: 401, reason: "missing-basic-auth" });
  });
});

describe("verifySalesforce — not-supported (intentional)", () => {
  it("reports not-supported so caller falls back to shared HMAC", () => {
    const r = verifySalesforce({ rawBody: BODY, headers: {}, method: "POST", url: "/x" });
    expect(r).toMatchObject({ ok: true, verified: false, reason: "not-supported", provider: "salesforce" });
  });
});

describe("verifyByProvider dispatcher", () => {
  it("routes hubspot to verifyHubspot", () => {
    const ts = Date.now();
    const sig = signHubspot(HUBSPOT_SECRET, "POST", "/x", BODY, ts);
    const r = verifyByProvider("hubspot", {
      rawBody: BODY,
      headers: {
        "x-hubspot-signature-v3": sig,
        "x-hubspot-request-timestamp": String(ts),
      },
      method: "POST",
      url: "/x",
      env: { HUBSPOT_WEBHOOK_SECRET: HUBSPOT_SECRET } as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: true, provider: "hubspot" });
  });

  it("unknown provider returns not-supported (so caller falls back)", () => {
    const r = verifyByProvider("zoho", {
      rawBody: BODY,
      headers: {},
      method: "POST",
      url: "/x",
      env: {} as NodeJS.ProcessEnv,
    });
    expect(r).toMatchObject({ ok: true, verified: false, reason: "not-supported", provider: "zoho" });
  });
});
