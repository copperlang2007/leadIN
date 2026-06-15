// Replit OIDC auth, ported to openid-client v5.7.0.
//
// Why v5 and not v6: v6 is ESM-only. Our deploy target (Railway) bundles
// via CJS and chokes on the v6 entry point — see commit 0ae2b6a
// "pin openid-client to v5.7.0 for CJS compatibility". v5.7.0 ships a
// CJS entry point and is API-stable.
//
// The shape difference vs v6: v5 is class-based (`Issuer` + per-issuer
// `Client`) rather than v6's functional `client.discovery()` /
// `client.refreshTokenGrant()`. The Strategy lives at the package root in
// v5, not at `openid-client/passport`. TokenSet replaces v6's
// TokenEndpointResponse + Helpers intersection — same accessors
// (`.claims()`, `.access_token`, `.refresh_token`, `.expires_at`).

import { Issuer, Strategy, type TokenSet, type Client } from "openid-client";

import passport from "passport";
import session, { type Store } from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { pool } from "./db";

// Cache the discovered issuer for an hour. The Issuer instance is cheap
// to build per-domain Clients off of, so we discover once and clone
// per-hostname below.
const getOidcIssuer = memoize(
  async () => {
    return await Issuer.discover(
      process.env.ISSUER_URL ?? "https://replit.com/oidc",
    );
  },
  { maxAge: 3600 * 1000 },
);

// Lazily-built session store. Exported so the WebSocket upgrade handler can
// look sessions up directly by sid without re-creating its own store.
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

function updateUserSession(user: any, tokens: TokenSet) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  // v5 TokenSet exposes expires_at as a unix timestamp; copy it through.
  user.expires_at = user.claims?.exp ?? tokens.expires_at;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

// Per-hostname client cache. The OIDC client is bound to a specific
// callback URL, so multi-domain deploys (replit.dev + custom domains)
// need one client per hostname. We reuse them so each strategy
// registration is cheap.
const clientByHostname = new Map<string, Client>();
function getClientForHostname(hostname: string): Promise<Client> {
  const existing = clientByHostname.get(hostname);
  if (existing) return Promise.resolve(existing);
  return (async () => {
    const issuer = await getOidcIssuer();
    const client = new issuer.Client({
      client_id: process.env.REPL_ID!,
      redirect_uris: [`https://${hostname}/api/callback`],
      response_types: ["code"],
      // No client_secret — Replit OIDC uses a public client model.
      token_endpoint_auth_method: "none",
    });
    clientByHostname.set(hostname, client);
    return client;
  })();
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Pre-warm the issuer discovery so the first /api/login isn't slow.
  // Failure here is non-fatal — getClientForHostname will retry.
  void getOidcIssuer().catch(() => {});

  // Keep track of registered strategies so we don't double-register on
  // every request to the same hostname.
  const registeredStrategies = new Set<string>();

  const ensureStrategy = async (hostname: string) => {
    const strategyName = `replitauth:${hostname}`;
    if (registeredStrategies.has(strategyName)) return strategyName;

    const oidcClient = await getClientForHostname(hostname);
    const strategy = new Strategy(
      {
        client: oidcClient,
        params: { scope: "openid email profile offline_access" },
        // Pass usePKCE: true if the IdP requires it; Replit's flow uses
        // the standard auth-code grant without PKCE for now.
      },
      // v5 Strategy verify signature: (tokenSet, done) — no userinfo arg
      // when we don't ask for it. We pull claims off the TokenSet itself.
      async (tokenSet: TokenSet, done: passport.AuthenticateCallback) => {
        try {
          const user: any = {};
          updateUserSession(user, tokenSet);
          await upsertUser(tokenSet.claims());
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    );
    // v5 takes the strategy name on passport.use() rather than in opts.
    passport.use(strategyName, strategy);
    registeredStrategies.add(strategyName);
    return strategyName;
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", async (req, res, next) => {
    try {
      const name = await ensureStrategy(req.hostname);
      passport.authenticate(name, {
        prompt: "login consent",
        scope: ["openid", "email", "profile", "offline_access"],
      })(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/callback", async (req, res, next) => {
    try {
      const name = await ensureStrategy(req.hostname);
      passport.authenticate(name, {
        successReturnToOrRedirect: "/",
        failureRedirect: "/api/login",
      })(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/logout", async (req, res) => {
    try {
      const oidcClient = await getClientForHostname(req.hostname);
      const endSessionUrl = oidcClient.endSessionUrl({
        post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
      });
      req.logout(() => {
        res.redirect(endSessionUrl);
      });
    } catch {
      // If end-session URL can't be built (issuer unreachable), still log
      // the user out locally — better than refusing to sign them out.
      req.logout(() => res.redirect("/"));
    }
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const oidcClient = await getClientForHostname(req.hostname);
    const newTokenSet = await oidcClient.refresh(refreshToken);
    updateUserSession(user, newTokenSet);
    return next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
