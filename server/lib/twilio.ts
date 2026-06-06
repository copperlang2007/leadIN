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

function isLive(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function fakeUuid(): string {
  // deterministic-ish stub id — uses time + crypto bytes so unit tests can
  // still pass-through and assert prefix only.
  return crypto.randomBytes(8).toString("hex");
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
    Url: params.callbackUrl ?? "http://demo.twilio.com/docs/voice.xml",
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
    },
    body: body.toString(),
  });
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
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
    },
    body: body.toString(),
  });
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
