import { describe, it, expect } from "vitest";
import { validateEnv } from "./envValidation";

// Boot-time contract: server/index.ts throws when validateEnv() reports
// isProd && !ok. These tests lock that contract for the actual call sites
// (validateEnv reads process.env when no arg is passed, the boot path).
// The full rule-table coverage lives in scripts/validate-prod-env.test.ts.

function fullProd(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://x",
    SESSION_SECRET: "s",
    APP_URL: "https://app.example",
    STRIPE_SECRET_KEY: "sk_live_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_STARTER: "price_s",
    STRIPE_PRICE_GROWTH: "price_g",
    STRIPE_PRICE_SCALE: "price_x",
    CRM_WEBHOOK_SECRET: "crm-secret",
    SENTRY_DSN: "https://abc@sentry.io/1",
    REDIS_URL: "redis://x",
    VITE_STACK_PROJECT_ID: "proj_x",
    VITE_STACK_PUBLISHABLE_CLIENT_KEY: "pck_x",
    STACK_SECRET_SERVER_KEY: "ssk_x",
  } as NodeJS.ProcessEnv;
}

describe("envValidation — boot-time contract", () => {
  it("reports ok in prod when every required var is present", () => {
    const r = validateEnv(fullProd());
    expect(r.isProd).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("reports !ok in prod when SESSION_SECRET is missing (the headline boot crash)", () => {
    const env = fullProd();
    delete env.SESSION_SECRET;
    const r = validateEnv(env);
    expect(r.isProd).toBe(true);
    expect(r.ok).toBe(false);
    // Boot path uses .missing to decide whether to throw; tests pin both shape and content.
    expect(r.missing.some((m) => m.key === "SESSION_SECRET")).toBe(true);
  });

  it("dev mode never marks isProd, so boot never throws — even with everything missing", () => {
    const r = validateEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(r.isProd).toBe(false);
    // Boot guard is `if (isProd && !ok) throw`. Dev path must short-circuit on isProd alone.
    expect(r.isProd).toBe(false);
  });

  it("test mode behaves like dev — vitest.setup.ts stubs DATABASE_URL etc., but NODE_ENV=test never throws", () => {
    const r = validateEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(r.isProd).toBe(false);
  });
});

// Neon Auth landed after the Replit auth removal with no validator coverage,
// so a prod deploy with no auth keys booted green and silently rejected every
// sign-in. These pin the warnings without making the vars boot-blocking.
describe("envValidation — Neon Auth (Stack) warnings", () => {
  const authWarnings = (env: NodeJS.ProcessEnv) =>
    validateEnv(env).warnings.filter((w) => w.includes("STACK"));

  it("a fully configured prod deploy emits no auth warning", () => {
    expect(authWarnings(fullProd())).toHaveLength(0);
  });

  it("still boots: missing auth keys warn but never mark the result !ok", () => {
    const env = fullProd();
    delete env.VITE_STACK_PROJECT_ID;
    delete env.VITE_STACK_PUBLISHABLE_CLIENT_KEY;
    const r = validateEnv(env);
    // The whole point of warning rather than requiring — server/neonAuth.ts
    // documents unset as the supported auth-off posture.
    expect(r.ok).toBe(true);
    expect(r.missing.some((m) => m.key.includes("STACK"))).toBe(false);
  });

  it("warns that no one can sign in when both values are unset in prod", () => {
    const env = fullProd();
    delete env.VITE_STACK_PROJECT_ID;
    delete env.VITE_STACK_PUBLISHABLE_CLIENT_KEY;
    const w = authWarnings(env);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/No one can sign in/i);
  });

  // client/src/lib/stack.ts gates on `projectId && publishableClientKey`, so
  // neither half-configured state renders a sign-in form. An earlier version of
  // this warning claimed the opposite; these pin the real outcome.
  it("half-configured (client key set, project id missing) reports the config notice, not a working form", () => {
    const env = fullProd();
    delete env.VITE_STACK_PROJECT_ID;
    const w = authWarnings(env);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/config notice/i);
    expect(w[0]).toMatch(/No one can sign in/i);
    // The server exchange is broken too — the JWKS URL derives from the project id.
    expect(w[0]).toMatch(/503/);
    expect(w[0]).not.toMatch(/sign-in will render/i);
  });

  it("half-configured (project id set, client key missing) also reports the config notice", () => {
    const env = fullProd();
    delete env.VITE_STACK_PUBLISHABLE_CLIENT_KEY;
    const w = authWarnings(env);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/config notice/i);
    expect(w[0]).toMatch(/No one can sign in/i);
  });

  it("warns that profile enrichment is off when only STACK_SECRET_SERVER_KEY is missing", () => {
    const env = fullProd();
    delete env.STACK_SECRET_SERVER_KEY;
    const w = authWarnings(env);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/STACK_SECRET_SERVER_KEY/);
    // Degraded, not broken — the message must not imply sign-in is down.
    expect(w[0]).toMatch(/Sign-in itself still works/i);
  });

  it("reports only the sign-in blocker when the server key is missing too — no double warning", () => {
    const env = fullProd();
    delete env.VITE_STACK_PROJECT_ID;
    delete env.VITE_STACK_PUBLISHABLE_CLIENT_KEY;
    delete env.STACK_SECRET_SERVER_KEY;
    const w = authWarnings(env);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Neon Auth is off/i);
  });

  it("stays quiet outside production — unset auth is the documented dev/CI posture", () => {
    expect(authWarnings({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toHaveLength(0);
    expect(authWarnings({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toHaveLength(0);
  });
});
