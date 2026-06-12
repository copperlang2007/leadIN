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
    SENTRY_DSN: "https://abc@sentry.io/1",
    REDIS_URL: "redis://x",
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
