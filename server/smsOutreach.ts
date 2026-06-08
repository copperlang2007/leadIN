// Wave 7 (T7) — TCPA-safe SMS outreach for agents.
//
// Agents can send canned, compliance-vetted SMS to leads they have
// purchased. Every outbound template:
//   1. References a prior call / existing relationship (not cold contact),
//   2. ends with a "Reply STOP to opt out" footer,
//   3. only allows the placeholders {firstName}, {state}, {agentName}.
//
// The actual send is delegated to lib/twilio.sendSms (which is stubbed in
// dev/CI when no creds are configured). Every outbound + inbound message
// is written to sms_logs (Wave 6a schema) with `direction = 'out' | 'in'`.
//
// Rate limit: 50 SMS / agent / hour, enforced via the shared `takeToken`
// token bucket in server/rateLimit (Redis-backed in prod, memory in tests).
//
// Opt-out enforcement: rather than adding a schema column, we treat any
// inbound message from the lead within the last 30 days that contains the
// substring "STOP" (case-insensitive) as a hard opt-out — sendOutreach
// refuses to dispatch in that case.

import { sendSms as twilioSendSms } from "./lib/twilio";
import { takeToken } from "./rateLimit";
import type { IStorage } from "./storage";
import { storage as defaultStorage } from "./storage";

// ──────────────────────────────────────────────────────
// Template registry
// ──────────────────────────────────────────────────────

export interface SmsTemplate {
  key: string;
  label: string;
  /** Variables the template uses (subset of ALLOWED_VARS). */
  variables: ReadonlyArray<AllowedVar>;
  /** Template body without the opt-out footer (footer is appended at send). */
  body: string;
}

export const OPT_OUT_FOOTER = "Reply STOP to opt out.";

/**
 * Whitelist of placeholders the template engine accepts. Adding any other
 * `{token}` in a template body — or supplying any other key in `variables`
 * at send time — is rejected with InvalidPlaceholderError.
 */
export const ALLOWED_VARS = ["firstName", "state", "agentName"] as const;
export type AllowedVar = (typeof ALLOWED_VARS)[number];

/**
 * Canned, TCPA-safe templates. Every body confirms a prior relationship
 * (e.g., "following our recent call") so a regulator reviewing the message
 * can see it isn't unsolicited cold contact.
 *
 * Five templates — one for each of the common agent touchpoints.
 */
export const TEMPLATES: ReadonlyArray<SmsTemplate> = [
  {
    key: "intro",
    label: "Intro after first call",
    variables: ["firstName", "agentName"],
    body:
      "Hi {firstName}, this is {agentName} following up on our recent call about your insurance options. " +
      "Reach out anytime with questions.",
  },
  {
    key: "appointment_reminder",
    label: "Appointment reminder",
    variables: ["firstName", "agentName"],
    body:
      "Hi {firstName} — {agentName} here, just a reminder of our scheduled call to review the plan options we discussed. " +
      "Talk soon.",
  },
  {
    key: "follow_up",
    label: "Follow up on quote",
    variables: ["firstName", "agentName"],
    body:
      "Hi {firstName}, this is {agentName}. Following up on the quote we reviewed together — let me know if you'd like to move forward.",
  },
  {
    key: "missed_call",
    label: "Missed call",
    variables: ["firstName", "agentName"],
    body:
      "Hi {firstName}, {agentName} here. I tried calling you back as we discussed. Reply or call when convenient.",
  },
  {
    key: "compliance_check",
    label: "Compliance / consent confirmation",
    variables: ["firstName", "state", "agentName"],
    body:
      "Hi {firstName}, {agentName} confirming you requested information about coverage in {state}. " +
      "Reply YES to continue or just text me back any questions.",
  },
];

const TEMPLATE_BY_KEY: Map<string, SmsTemplate> = new Map(TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string): SmsTemplate | undefined {
  return TEMPLATE_BY_KEY.get(key);
}

export function listTemplates(): ReadonlyArray<SmsTemplate> {
  return TEMPLATES;
}

// ──────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────

export class UnknownTemplateError extends Error {
  constructor(key: string) {
    super(`unknown template: ${key}`);
    this.name = "UnknownTemplateError";
  }
}

export class InvalidPlaceholderError extends Error {
  constructor(public token: string) {
    super(`invalid placeholder: {${token}} — only {firstName}, {state}, {agentName} are allowed`);
    this.name = "InvalidPlaceholderError";
  }
}

export class MissingPurchaseError extends Error {
  constructor(public leadId: number, public agentUserId: string) {
    super(`agent ${agentUserId} has not purchased lead ${leadId}`);
    this.name = "MissingPurchaseError";
  }
}

export class OptedOutError extends Error {
  constructor(public leadId: number) {
    super(`lead ${leadId} has opted out of SMS (replied STOP within 30d)`);
    this.name = "OptedOutError";
  }
}

export class RateLimitExceededError extends Error {
  constructor() {
    super("sms rate limit exceeded (50 / agent / hour)");
    this.name = "RateLimitExceededError";
  }
}

export class NoConsumerPhoneError extends Error {
  constructor(public leadId: number) {
    super(`lead ${leadId} has no consumer phone on file`);
    this.name = "NoConsumerPhoneError";
  }
}

// ──────────────────────────────────────────────────────
// Placeholder substitution (pure)
// ──────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Replace `{firstName}` style placeholders in `body` with values from
 * `variables`. Rejects any placeholder name not in ALLOWED_VARS (defence
 * against template authors smuggling in unsanitised PII fields).
 *
 * Missing values are replaced with the empty string so a partial set of
 * variables doesn't leak the raw "{firstName}" into the SMS body — the
 * caller is responsible for supplying the variables the template declares.
 */
export function renderTemplate(body: string, variables: Record<string, string | undefined | null>): string {
  // Validate variables map keys first — any extraneous key is a hard error.
  for (const k of Object.keys(variables)) {
    if (!(ALLOWED_VARS as ReadonlyArray<string>).includes(k)) {
      throw new InvalidPlaceholderError(k);
    }
  }

  return body.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (!(ALLOWED_VARS as ReadonlyArray<string>).includes(name)) {
      throw new InvalidPlaceholderError(name);
    }
    const val = variables[name];
    return val == null ? "" : String(val);
  });
}

/** Append the TCPA opt-out footer if not already present. */
export function withOptOutFooter(body: string): string {
  // Idempotent — agents who paste templates with the footer already in
  // don't get a doubled footer.
  return body.includes(OPT_OUT_FOOTER) ? body : `${body.trimEnd()} ${OPT_OUT_FOOTER}`;
}

// ──────────────────────────────────────────────────────
// Opt-out detection
// ──────────────────────────────────────────────────────

const STOP_KEYWORDS = ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const OPT_OUT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isStopMessage(body: string): boolean {
  const upper = body.trim().toUpperCase();
  // Treat as STOP if the message *is* a stop keyword, or starts with one
  // (so "STOP please" counts). We deliberately avoid substring-anywhere
  // matching so a legitimate "I'll stop by tomorrow" doesn't opt them out.
  return STOP_KEYWORDS.some((kw) => upper === kw || upper.startsWith(kw + " ") || upper.startsWith(kw + "."));
}

/**
 * Returns true when the lead has sent any inbound message in the last 30
 * days that triggers `isStopMessage`. Pulls from the SmsLog list provided
 * by the caller — kept pure for testability.
 */
export function hasRecentOptOut(
  inboundLogs: Array<{ direction: string; body: string; createdAt?: Date | null }>,
  now: Date = new Date(),
): boolean {
  const cutoff = now.getTime() - OPT_OUT_WINDOW_MS;
  for (const row of inboundLogs) {
    if (row.direction !== "in") continue;
    const t = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    if (t < cutoff) continue;
    if (isStopMessage(row.body)) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────
// Rate-limit constants
// ──────────────────────────────────────────────────────

export const SMS_RATE_CAPACITY = 50;
/** 50 tokens / hour → refill 50/3600 per second. */
export const SMS_RATE_REFILL_PER_SEC = SMS_RATE_CAPACITY / 3600;

export function rateLimitKey(agentUserId: string): string {
  return `sms:out:${agentUserId}`;
}

// ──────────────────────────────────────────────────────
// sendOutreach — top-level entry point
// ──────────────────────────────────────────────────────

export interface SendOutreachInput {
  agentUserId: string;
  leadId: number;
  templateKey: string;
  variables?: Record<string, string | undefined | null>;
}

export interface SendOutreachResult {
  smsLogId: number;
  twilioSid: string | null;
  status: string;
  body: string;
}

export interface SendOutreachDeps {
  /** Override storage in tests. Defaults to the real DatabaseStorage. */
  storage?: Pick<
    IStorage,
    "getLead" | "getOrderForLead" | "createSmsLog" | "listSmsLogsForLead"
  >;
  /** Override sendSms in tests. Defaults to lib/twilio.sendSms. */
  sendSms?: typeof twilioSendSms;
  /** Override rate limiter in tests. Defaults to rateLimit.takeToken. */
  takeToken?: typeof takeToken;
}

/**
 * Send a templated SMS to a purchased lead.
 *
 * Steps:
 *  1. Verify the agent has an order for this leadId (else MissingPurchaseError).
 *  2. Pull the most recent SMS history; refuse if a STOP arrived in 30d.
 *  3. Take a token from the per-agent rate-limit bucket (50/hr).
 *  4. Render the template + append opt-out footer.
 *  5. Call lib/twilio.sendSms.
 *  6. Persist an sms_logs row (direction='out').
 */
export async function sendOutreach(
  input: SendOutreachInput,
  deps: SendOutreachDeps = {},
): Promise<SendOutreachResult> {
  const store = deps.storage ?? defaultStorage;
  const send = deps.sendSms ?? twilioSendSms;
  const take = deps.takeToken ?? takeToken;

  const template = getTemplate(input.templateKey);
  if (!template) throw new UnknownTemplateError(input.templateKey);

  // Verify purchase — agent must have an order on this lead.
  const order = await store.getOrderForLead(input.agentUserId, input.leadId);
  if (!order) throw new MissingPurchaseError(input.leadId, input.agentUserId);

  // Pull the lead to get the consumer phone.
  const lead = await store.getLead(input.leadId);
  if (!lead) throw new MissingPurchaseError(input.leadId, input.agentUserId);
  const toPhone = lead.consumerPhone;
  if (!toPhone) throw new NoConsumerPhoneError(input.leadId);

  // Opt-out check.
  const logs = await store.listSmsLogsForLead(input.leadId, input.agentUserId);
  if (hasRecentOptOut(logs)) throw new OptedOutError(input.leadId);

  // Rate limit (50/hr/agent).
  const allowed = await take(rateLimitKey(input.agentUserId), SMS_RATE_CAPACITY, SMS_RATE_REFILL_PER_SEC);
  if (!allowed) throw new RateLimitExceededError();

  // Render body + footer.
  const renderedBody = renderTemplate(template.body, input.variables ?? {});
  const body = withOptOutFooter(renderedBody);

  // Dispatch via Twilio.
  const tw = await send({
    fromAgentId: input.agentUserId,
    leadId: input.leadId,
    toPhone,
    body,
  });

  // Persist outbound log.
  const log = await store.createSmsLog({
    agentUserId: input.agentUserId,
    leadId: input.leadId,
    twilioSid: tw.sid,
    direction: "out",
    body,
    status: tw.status ?? "queued",
  });

  return {
    smsLogId: log.id,
    twilioSid: tw.sid,
    status: tw.status ?? "queued",
    body,
  };
}
