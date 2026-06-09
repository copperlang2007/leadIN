import { describe, it, expect } from "vitest";
import { validateEnv, formatResult, PROD_ENV_RULES } from "./validate-prod-env.js";

function baseProd(): NodeJS.ProcessEnv {
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

describe("validateEnv", () => {
  it("passes when all required prod vars present", () => {
    const r = validateEnv(baseProd());
    expect(r.ok).toBe(true);
    expect(r.isProd).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("flags each missing required prod var with a reason", () => {
    const env = baseProd();
    delete env.DATABASE_URL;
    delete env.STRIPE_WEBHOOK_SECRET;
    const r = validateEnv(env);
    expect(r.ok).toBe(false);
    const keys = r.missing.map((m) => m.key).sort();
    expect(keys).toContain("DATABASE_URL");
    expect(keys).toContain("STRIPE_WEBHOOK_SECRET");
    for (const m of r.missing) expect(m.reason.length).toBeGreaterThan(0);
  });

  it("does not require prod vars in non-prod", () => {
    const r = validateEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(r.isProd).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("pulls in TWILIO_* when FEATURE_DIALER is enabled", () => {
    const env = baseProd();
    env.FEATURE_DIALER = "true";
    const r = validateEnv(env);
    expect(r.ok).toBe(false);
    const keys = r.missing.map((m) => m.key).sort();
    expect(keys).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]);
  });

  it("treats 'false'/'0' feature flags as off", () => {
    const env = baseProd();
    env.FEATURE_DIALER = "false";
    const r = validateEnv(env);
    expect(r.ok).toBe(true);
  });

  it("warns (not fails) when SENTRY_DSN unset in prod", () => {
    const env = baseProd();
    delete env.SENTRY_DSN;
    const r = validateEnv(env);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("SENTRY_DSN"))).toBe(true);
  });

  it("warns when REDIS_URL unset", () => {
    const env = baseProd();
    delete env.REDIS_URL;
    const r = validateEnv(env);
    expect(r.warnings.some((w) => w.includes("REDIS_URL"))).toBe(true);
  });

  it("non-prod with FEATURE_DNC_VENDOR set still demands the keys (catches misconfig early)", () => {
    const env = { NODE_ENV: "development", FEATURE_DNC_VENDOR: "1" } as NodeJS.ProcessEnv;
    const r = validateEnv(env);
    expect(r.missing.map((m) => m.key).sort()).toEqual(["DNC_VENDOR_API_KEY", "DNC_VENDOR_API_URL"]);
  });
});

describe("formatResult", () => {
  it("renders ok state with rule count", () => {
    const out = formatResult(validateEnv(baseProd()));
    expect(out).toContain("Production");
    expect(out).toContain(`${PROD_ENV_RULES.length} rules`);
  });

  it("renders missing keys with their reason", () => {
    const env = baseProd();
    delete env.STRIPE_PRICE_GROWTH;
    const out = formatResult(validateEnv(env));
    expect(out).toContain("STRIPE_PRICE_GROWTH");
    expect(out).toContain("Stripe price id");
  });
});
