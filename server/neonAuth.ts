// Neon Auth (Stack Auth) session authentication.
//
// Architecture: the SPA signs the user in with Neon Auth's client SDK
// (@stackframe/react) and then exchanges the short-lived Stack access token
// for a first-party server session via POST /api/auth/session. The server
// verifies the JWT against the project's JWKS, upserts the user row, and
// stores the identity in the existing express-session (Postgres `sessions`
// table). Everything downstream — cookie-based fetches, the WebSocket
// upgrade check that looks sids up in the sessions table, CSRF
// double-submit — is untouched by design: only the identity handshake
// changed when the previous OIDC provider was removed.
//
// Configuration (see .env.example):
//   VITE_STACK_PROJECT_ID              Neon Auth project id (client + server)
//   VITE_STACK_PUBLISHABLE_CLIENT_KEY  client SDK key (client only)
//   STACK_SECRET_SERVER_KEY            server key — enables profile fetch
//   NEON_AUTH_API_URL                  override, default https://api.stack-auth.com
//   NEON_AUTH_JWKS_URL                 override, default derived from project id
//
// When VITE_STACK_PROJECT_ID is unset, the exchange endpoint returns 503 and
// every guarded route 401s — the same "auth not configured" dev posture the
// previous flow had, so unit/e2e suites run without external services.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import session, { type Store } from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { pool } from "./db";
import { logError } from "./lib/safeError";

const STACK_API_URL = () => process.env.NEON_AUTH_API_URL || "https://api.stack-auth.com";
const PROJECT_ID = () => process.env.VITE_STACK_PROJECT_ID || "";

function jwksUrl(): string {
  return (
    process.env.NEON_AUTH_JWKS_URL ||
    `${STACK_API_URL()}/api/v1/projects/${encodeURIComponent(PROJECT_ID())}/.well-known/jwks.json`
  );
}

// Remote JWKS is cached by jose; rebuild only if the URL changes (env is
// effectively static per-process, so this builds once).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksBuiltFor = "";
function getJwks() {
  const url = jwksUrl();
  if (!jwks || jwksBuiltFor !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksBuiltFor = url;
  }
  return jwks;
}

// The session-stored identity. Mirrors the claims shape the previous auth flow put
// on req.user so the ~100 `req.user.claims.sub` call sites need no changes.
export interface AuthClaims {
  sub: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
}
interface SessionAuth {
  claims: AuthClaims;
  // Unix seconds; informational — the session cookie TTL is the real bound.
  expires_at: number;
}
declare module "express-session" {
  interface SessionData {
    authUser?: SessionAuth;
  }
}

// ── Session store (unchanged from the previous auth layer) ──────────────
let cachedSessionStore: Store | null = null;
export function getSessionStore(): Store {
  if (cachedSessionStore) return cachedSessionStore;
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  cachedSessionStore = new pgStore({
    pool,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return cachedSessionStore;
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  return session({
    secret: process.env.SESSION_SECRET!,
    store: getSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Only require Secure cookies in production. Local dev uses http://.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

/**
 * Verify a Neon Auth access token (signature + expiry against the project
 * JWKS) and return its payload. The JWKS is project-scoped, so a valid
 * signature already binds the token to this project.
 */
export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getJwks());
  if (!payload.sub) throw new Error("access token has no sub claim");
  return payload;
}

/**
 * Best-effort profile fetch from the Neon Auth (Stack) REST API using the
 * secret server key. Falls back to token claims when the key is unset or
 * the request fails — sign-in still works, the user row is just sparser
 * until the next successful fetch.
 */
async function fetchProfile(accessToken: string, payload: JWTPayload): Promise<AuthClaims> {
  const sub = String(payload.sub);
  const fallback: AuthClaims = {
    sub,
    email: typeof payload.email === "string" ? payload.email : null,
    first_name: null,
    last_name: null,
    profile_image_url: null,
  };
  const serverKey = process.env.STACK_SECRET_SERVER_KEY;
  if (!serverKey) return fallback;
  try {
    const res = await fetch(`${STACK_API_URL()}/api/v1/users/me`, {
      headers: {
        "x-stack-access-type": "server",
        "x-stack-project-id": PROJECT_ID(),
        "x-stack-secret-server-key": serverKey,
        "x-stack-access-token": accessToken,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logError(`[neon-auth] profile fetch non-OK ${res.status}`, new Error(String(res.status)));
      return fallback;
    }
    const body: any = await res.json();
    const displayName: string = body?.display_name ?? "";
    const spaceIdx = displayName.indexOf(" ");
    return {
      sub,
      email: body?.primary_email ?? fallback.email,
      first_name: displayName ? (spaceIdx === -1 ? displayName : displayName.slice(0, spaceIdx)) : null,
      last_name: spaceIdx === -1 ? null : displayName.slice(spaceIdx + 1) || null,
      profile_image_url: body?.profile_image_url ?? null,
    };
  } catch (err) {
    logError("[neon-auth] profile fetch failed", err);
    return fallback;
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  // Bridge the session identity onto req.user in the shape the routes
  // expect ({ claims: { sub, ... } }). Runs on every request; cheap.
  app.use((req, _res, next) => {
    if (req.session.authUser) {
      (req as any).user = req.session.authUser;
    }
    next();
  });

  // Exchange a verified Neon Auth access token for a server session. The
  // SPA calls this once after the Stack sign-in completes.
  app.post("/api/auth/session", async (req, res) => {
    try {
      if (!PROJECT_ID()) {
        return res.status(503).json({ message: "Neon Auth is not configured (VITE_STACK_PROJECT_ID unset)" });
      }
      const accessToken = typeof req.body?.accessToken === "string" ? req.body.accessToken : "";
      if (!accessToken) {
        return res.status(400).json({ message: "accessToken required" });
      }
      let payload: JWTPayload;
      try {
        payload = await verifyAccessToken(accessToken);
      } catch {
        return res.status(401).json({ message: "Invalid or expired access token" });
      }

      const claims = await fetchProfile(accessToken, payload);
      await storage.upsertUser({
        id: claims.sub,
        email: claims.email ?? undefined,
        firstName: claims.first_name ?? undefined,
        lastName: claims.last_name ?? undefined,
        profileImageUrl: claims.profile_image_url ?? undefined,
      });

      // Rotate the session id on login to prevent fixation.
      await new Promise<void>((resolve, reject) =>
        req.session.regenerate(err => (err ? reject(err) : resolve())),
      );
      req.session.authUser = {
        claims,
        expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      };
      await new Promise<void>((resolve, reject) =>
        req.session.save(err => (err ? reject(err) : resolve())),
      );
      res.status(201).json({ id: claims.sub, email: claims.email });
    } catch (err) {
      logError("[neon-auth] session exchange failed", err);
      res.status(500).json({ message: "Failed to establish session" });
    }
  });

  // Legacy entry point — old links and client fallbacks land on the SPA
  // sign-in page.
  app.get("/api/login", (_req, res) => res.redirect("/auth"));

  // Destroy the server session, then land on /auth with a flag that tells
  // the SPA to also sign out of the Neon Auth client SDK (clearing its
  // cookies) — without that, revisiting /auth would silently re-login.
  app.get("/api/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/auth?signout=1"));
  });
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.session?.authUser?.claims?.sub) return next();
  return res.status(401).json({ message: "Unauthorized" });
};
