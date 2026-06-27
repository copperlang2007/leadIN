// Ping-post intake — real-time lead bidding, the distribution primitive that
// commodity platforms (Boberdoo, Phonexa) compete on. A vendor first PINGs the
// platform with a lead's non-PII attributes; the platform returns a binding
// price quote + a signed offer token. The vendor then POSTs the full lead with
// that token to claim the quoted price. The token is an HMAC-signed, expiring
// offer so the post step is stateless and tamper-evident — no server-side
// session needed, and a vendor can't forge or inflate a quote.
//
// All pure functions (HMAC via node crypto) so the bidding logic is fully
// unit-testable. Pricing reuses the phase-1 intent pricing engine.

import { createHmac, timingSafeEqual } from "node:crypto";
import { priceLead } from "./intentPricing";

export interface PingAttributes {
  type: string;
  state: string;
  exclusivity: string;
  /** Estimated MediScore 0..100 from the attributes the vendor shares at ping. */
  mediscoreEstimate?: number;
  /** Estimated intent 0..100. */
  intentScore?: number;
  hasPhone: boolean;
  hasConsent: boolean;
}

export interface PingOptions {
  basePrice: number | string;
  secret: string;
  /** Offer time-to-live in seconds (default 120). */
  ttlSeconds?: number;
  /** Live demand index for surge pricing. */
  demandIndex?: number;
  /** Require consent at ping time (default true). */
  requireConsent?: boolean;
  /** Unique id for this ping (e.g. a request id). */
  pingId: string;
  /** Current time (ms). Injected for deterministic tests. */
  nowMs?: number;
}

export interface OfferPayload {
  pingId: string;
  type: string;
  state: string;
  bidPrice: string;
  exp: number; // unix seconds
}

export interface PingDecision {
  accept: boolean;
  bidPrice: string;
  reasons: string[];
  token: string | null;
  expiresAt: string | null;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sign an offer payload → "<base64url(json)>.<base64url(hmac)>". */
export function signOffer(payload: OfferPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

export interface VerifyResult {
  valid: boolean;
  reason: string;
  payload?: OfferPayload;
}

/** Verify an offer token: signature + expiry. Constant-time MAC comparison. */
export function verifyOffer(token: string, secret: string, nowMs = Date.now()): VerifyResult {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, reason: "malformed_token" };
  }
  const [body, mac] = token.split(".");
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad_signature" };
  }
  let payload: OfferPayload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return { valid: false, reason: "bad_payload" };
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < nowMs) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, reason: "ok", payload };
}

/**
 * Evaluate a ping: decide accept/reject and, if accepted, quote a price and
 * mint a signed offer token. Pure & deterministic given `nowMs`.
 */
export function evaluatePing(attrs: PingAttributes, opts: PingOptions): PingDecision {
  const now = opts.nowMs ?? Date.now();
  const ttl = opts.ttlSeconds ?? 120;
  const requireConsent = opts.requireConsent ?? true;

  const reasons: string[] = [];
  if (!attrs.type) reasons.push("missing_type");
  if (!attrs.state) reasons.push("missing_state");
  if (!attrs.hasPhone) reasons.push("missing_phone");
  if (requireConsent && !attrs.hasConsent) reasons.push("missing_consent");

  if (reasons.length > 0) {
    return { accept: false, bidPrice: "0.00", reasons, token: null, expiresAt: null };
  }

  const pricing = priceLead({
    basePrice: opts.basePrice,
    mediscore: attrs.mediscoreEstimate ?? 50,
    intentScore: attrs.intentScore ?? 50,
    exclusivity: attrs.exclusivity,
    demandIndex: opts.demandIndex,
  });

  const exp = Math.floor(now / 1000) + ttl;
  const payload: OfferPayload = {
    pingId: opts.pingId,
    type: attrs.type,
    state: attrs.state.toUpperCase(),
    bidPrice: pricing.price,
    exp,
  };

  return {
    accept: true,
    bidPrice: pricing.price,
    reasons: [],
    token: signOffer(payload, opts.secret),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Reads the ping-post HMAC secret from env (falls back to nothing → caller 503s). */
export function getPingPostSecret(): string | undefined {
  const s = process.env.PING_POST_SECRET;
  return s && s.trim() ? s : undefined;
}
