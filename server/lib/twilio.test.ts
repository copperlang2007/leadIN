import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("twilio live backend", () => {
  let saved: Record<string, string | undefined>;
  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    saved = {
      sid: process.env.TWILIO_ACCOUNT_SID,
      token: process.env.TWILIO_AUTH_TOKEN,
      phone: process.env.TWILIO_PHONE_NUMBER,
      twiml: process.env.TWILIO_VOICE_TWIML_URL,
    };
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "tok_test";
    process.env.TWILIO_PHONE_NUMBER = "+15550000000";
    delete process.env.TWILIO_VOICE_TWIML_URL;
    savedFetch = global.fetch;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries({
      TWILIO_ACCOUNT_SID: saved.sid,
      TWILIO_AUTH_TOKEN: saved.token,
      TWILIO_PHONE_NUMBER: saved.phone,
      TWILIO_VOICE_TWIML_URL: saved.twiml,
    })) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    global.fetch = savedFetch;
  });

  it("startCall REFUSES to place a call against demo TwiML when no URL is configured", async () => {
    // The whole point: a live call with no TwiML URL must throw, not
    // silently dial the consumer into Twilio's demo recording.
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    await expect(
      startCall({ fromAgentId: "u1", toPhone: "+15555550100" }),
    ).rejects.toThrow(/TwiML URL/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("startCall uses TWILIO_VOICE_TWIML_URL when set, never the demo URL", async () => {
    process.env.TWILIO_VOICE_TWIML_URL = "https://app.example/twiml/dial";
    let sentBody = "";
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      return Promise.resolve(new Response(JSON.stringify({ sid: "CA1", status: "queued" }), { status: 201 }));
    });
    const res = await startCall({ fromAgentId: "u1", toPhone: "+15555550100" });
    expect(res.sid).toBe("CA1");
    expect(sentBody).toContain("Url=https%3A%2F%2Fapp.example%2Ftwiml%2Fdial");
    expect(sentBody).not.toContain("demo.twilio.com");
  });

  it("startCall prefers an explicit per-call callbackUrl over the env default", async () => {
    process.env.TWILIO_VOICE_TWIML_URL = "https://app.example/default";
    let sentBody = "";
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      return Promise.resolve(new Response(JSON.stringify({ sid: "CA2", status: "queued" }), { status: 201 }));
    });
    await startCall({ fromAgentId: "u1", toPhone: "+15555550100", callbackUrl: "https://app.example/override" });
    expect(sentBody).toContain("override");
    expect(sentBody).not.toContain("default");
  });

  it("startCall throws a clear error on a non-OK Twilio response", async () => {
    process.env.TWILIO_VOICE_TWIML_URL = "https://app.example/twiml/dial";
    global.fetch = vi.fn().mockResolvedValue(new Response("auth failed", { status: 401 }));
    await expect(
      startCall({ fromAgentId: "u1", toPhone: "+15555550100" }),
    ).rejects.toThrow(/twilio call HTTP 401/);
  });

  it("sendSms posts to the Messages endpoint and returns the sid", async () => {
    let calledUrl = "";
    global.fetch = vi.fn().mockImplementation((url: string, _init: RequestInit) => {
      calledUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ sid: "SM1", status: "queued" }), { status: 201 }));
    });
    const res = await sendSms({ fromAgentId: "u1", toPhone: "+15555550100", body: "hi" });
    expect(res.sid).toBe("SM1");
    expect(calledUrl).toContain("/Messages.json");
  });

  it("surfaces an aborted request as a clear twilio-timeout error", async () => {
    process.env.TWILIO_VOICE_TWIML_URL = "https://app.example/twiml/dial";
    process.env.TWILIO_TIMEOUT_MS = "10";
    // fetch that only rejects when its abort signal fires — mimics a
    // hung connection that the AbortController times out.
    global.fetch = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    await expect(
      startCall({ fromAgentId: "u1", toPhone: "+15555550100" }),
    ).rejects.toThrow(/timed out after 10ms/);
  });
});
