// Wave 6 (K3, T7) — Twilio client + webhook signature verification.
//
// Stub mode when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN unset: returns
// fake sids prefixed with "stub:" so callers and tests can run without a
// real account. Webhook signature verification returns false in stub
// mode; routes should accept stub events when running in dev.

import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface StartCallParams {
  fromAgentId: string;
  leadId?: number | null;
  toPhone: string;
  fromPhone?: string;
  callbackUrl?: string;
}

export interface SendSmsParams {
  fromAgentId: string;
  leadId?: number | null;
  toPhone: string;
  fromPhone?: string;
  body: string;
}

export interface TwilioResult {
  sid: string;
  status: string;
  raw?: unknown;
}

const REQUEST_TIMEOUT_MS = 10_000;

function isLive(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function fakeUuid(): string {
  // deterministic-ish stub id — uses time + crypto bytes so unit tests can
  // still pass-through and assert prefix only.
  return crypto.randomBytes(8).toString("hex");
}

async function twilioFetch(url: string, sid: string, token: string, body: URLSearchParams): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      },
      body: body.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the TwiML Url for an outbound call.
 *
 * In stub mode this is never called. In LIVE mode we REFUSE to fall back
 * to Twilio's demo TwiML (http://demo.twilio.com/docs/voice.xml): a real
 * outbound call against that URL connects the consumer to Twilio's demo
 * recording ("thanks for trying our documentation…") rather than bridging
 * the agent — a billable call that does nothing useful, and arguably an
 * unsolicited contact playing unrelated audio. Better to fail with a clear
 * config error than place a demo call to a real consumer.
 *
 * Operators wire this by either passing callbackUrl per-call or setting
 * TWILIO_VOICE_TWIML_URL to an endpoint that returns <Dial> TwiML bridging
 * the agent.
 */
function resolveVoiceUrl(callbackUrl?: string): string {
  const url = callbackUrl || process.env.TWILIO_VOICE_TWIML_URL;
  if (!url) {
    throw new Error(
      "twilio: no TwiML URL configured — set TWILIO_VOICE_TWIML_URL (or pass callbackUrl) " +
        "to a <Dial> endpoint. Refusing to place a call against Twilio's demo TwiML.",
    );
  }
  return url;
}

export async function startCall(params: StartCallParams): Promise<TwilioResult> {
  if (!isLive()) {
    return { sid: "stub:" + fakeUuid(), status: "queued" };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = params.fromPhone || process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error("twilio: from phone number not configured");

  const body = new URLSearchParams({
    To: params.toPhone,
    From: from,
    Url: resolveVoiceUrl(params.callbackUrl),
  });
  const res = await twilioFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
    sid,
    token,
    body,
  );
  if (!res.ok) throw new Error(`twilio call HTTP ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return { sid: data.sid, status: data.status ?? "queued", raw: data };
}

export async function sendSms(params: SendSmsParams): Promise<TwilioResult> {
  if (!isLive()) {
    return { sid: "stub:" + fakeUuid(), status: "queued" };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = params.fromPhone || process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error("twilio: from phone number not configured");

  const body = new URLSearchParams({
    To: params.toPhone,
    From: from,
    Body: params.body,
  });
  const res = await twilioFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    sid,
    token,
    body,
  );
  if (!res.ok) throw new Error(`twilio sms HTTP ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return { sid: data.sid, status: data.status ?? "queued", raw: data };
}

/**
 * Verify a Twilio webhook by computing HMAC-SHA1 over the request URL plus
 * sorted form-body params and comparing to the X-Twilio-Signature header.
 *
 * Returns false when running in stub mode (no token) — the calling route
 * is expected to accept stub events in dev.
 */
export function verifyWebhook(
  req: { headers: Record<string, string | string[] | undefined>; body?: Record<string, string> | undefined; url?: string },
  fullUrl?: string,
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;

  const sigHeader = req.headers["x-twilio-signature"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!signature) return false;

  const url = fullUrl || req.url || "";
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const sortedKeys = Object.keys(body).sort();
  const data = sortedKeys.reduce((acc, k) => acc + k + String(body[k]), url);

  const expected = crypto.createHmac("sha1", token).update(data).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function isTwilioLive(): boolean {
  return isLive();
}

// Helper to extract Twilio webhook URL from a Node IncomingMessage. Exposed
// so route code can pass the right URL to verifyWebhook in production.
export function twilioWebhookUrl(req: IncomingMessage, baseUrl?: string): string {
  const base = baseUrl || process.env.APP_URL || "";
  const path = req.url ?? "";
  return base.replace(/\/$/, "") + path;
}
