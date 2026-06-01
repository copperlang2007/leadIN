// Double-submit-cookie CSRF protection.
//
// The server issues a random token via the `lm_csrf` cookie on the first GET.
// State-changing requests must echo that token in the `X-CSRF-Token` header.
// Because attacker-controlled origins cannot read the cookie (same-site is
// already on `httpOnly` session, the csrf cookie is non-httpOnly so the SPA
// can read it), they cannot forge a matching header — blocking CSRF.
//
// Exempt:
//   - Safe methods (GET/HEAD/OPTIONS)
//   - Endpoints that authenticate via a separate signature/API-key path:
//     /api/stripe/webhook  (Stripe signature)
//     /api/v1/leads/ingest (X-Api-Key)

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const COOKIE_NAME = "lm_csrf";
const HEADER_NAME = "x-csrf-token";

const EXEMPT_PATHS = new Set<string>([
  "/api/stripe/webhook",
  "/api/v1/leads/ingest",
  // The login flow is OAuth-redirect-based; the callback comes back to GET.
  "/api/login",
  "/api/callback",
  "/api/logout",
]);

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function setCookieHeader(res: Response, name: string, value: string): void {
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=2592000", // 30 days
  ];
  if (isProd) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookieHeader(req.headers.cookie);
  let token = cookies[COOKIE_NAME];

  // Issue token if not present
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    setCookieHeader(res, COOKIE_NAME, token);
  }

  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  if (EXEMPT_PATHS.has(req.path)) return next();
  // Allow any unauthenticated POST that the app explicitly accepts from anon
  // users (events tracker) – it isn't a CSRF target because there's no
  // user-scoped action to forge.
  if (req.path === "/api/events/track" && !(req as any).user) return next();

  const sent = String(req.headers[HEADER_NAME] ?? "");
  if (!sent || !token || sent.length !== token.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token))) {
    res.status(403).json({ message: "CSRF token mismatch" });
    return;
  }
  next();
}

export const CSRF_COOKIE_NAME = COOKIE_NAME;
export const CSRF_HEADER_NAME = HEADER_NAME;
