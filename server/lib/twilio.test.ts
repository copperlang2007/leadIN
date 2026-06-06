import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { startCall, sendSms, verifyWebhook, isTwilioLive } from "./twilio.js";

describe("twilio stub backend", () => {
  let savedSid: string | undefined;
  let savedToken: string | undefined;
  beforeEach(() => {
    savedSid = process.env.TWILIO_ACCOUNT_SID;
    savedToken = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });
  afterEach(() => {
    if (savedSid !== undefined) process.env.TWILIO_ACCOUNT_SID = savedSid;
    if (savedToken !== undefined) process.env.TWILIO_AUTH_TOKEN = savedToken;
  });

  it("startCall returns a stub sid when no credentials are set", async () => {
    const res = await startCall({ fromAgentId: "u1", toPhone: "+15555550100" });
    expect(res.sid.startsWith("stub:")).toBe(true);
    expect(res.status).toBe("queued");
    expect(isTwilioLive()).toBe(false);
  });

  it("sendSms returns a stub sid when no credentials are set", async () => {
    const res = await sendSms({ fromAgentId: "u1", toPhone: "+15555550100", body: "hi" });
    expect(res.sid.startsWith("stub:")).toBe(true);
  });

  it("verifyWebhook returns false in stub mode", () => {
    const ok = verifyWebhook(
      { headers: { "x-twilio-signature": "abc" }, body: { foo: "bar" }, url: "https://example.com/twilio/cb" },
      "https://example.com/twilio/cb",
    );
    expect(ok).toBe(false);
  });

  it("verifyWebhook validates a correct HMAC-SHA1 signature when token is set", () => {
    const token = "test-token-12345";
    process.env.TWILIO_AUTH_TOKEN = token;
    const url = "https://example.com/twilio/cb";
    const body = { CallSid: "CA123", From: "+15551234567" };
    const data = url + Object.keys(body).sort().reduce((acc, k) => acc + k + String((body as any)[k]), "");
    const signature = crypto.createHmac("sha1", token).update(data).digest("base64");

    const ok = verifyWebhook(
      { headers: { "x-twilio-signature": signature }, body, url },
      url,
    );
    expect(ok).toBe(true);
  });
});
