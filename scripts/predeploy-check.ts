// Pre-deploy verifier.
//
// `npm run check:prod-env` already covers "are the required env vars
// present" — but a half-set env can still wreck a prod deploy in
// shapes the presence check can't catch:
//
//  - STRIPE_SECRET_KEY paste mistake (pasted the publishable key)
//  - DATABASE_URL with no host (just `postgres://`)
//  - SESSION_SECRET that's the literal word "secret"
//  - STRIPE_SECRET_KEY === STRIPE_WEBHOOK_SECRET (same value pasted twice)
//  - APP_URL pointing at http:// in production
//
// This runs offline (no network), so an operator can pipe their prod
// env into it before they ship and get a concrete go/no-go list. The
// shape mirrors validateEnv: a structured result + CLI exit code so
// it's automatable in a deploy pipeline.

import { validateEnv, type ValidationResult } from "../server/lib/envValidation";

export type CheckStatus = "pass" | "warn" | "fail";

export interface PreDeployCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface PreDeployResult {
  ok: boolean;
  isProd: boolean;
  envValidation: ValidationResult;
  checks: PreDeployCheck[];
}

function isPresent(v: string | undefined): boolean {
  return v !== undefined && v.trim().length > 0;
}

// Each formatter is a small predicate-style check that runs only when
// the relevant env var is present. Pure, no I/O.
const FORMAT_RULES: Array<(env: NodeJS.ProcessEnv) => PreDeployCheck | null> = [
  // Stripe secret key shape.
  (env) => {
    if (!isPresent(env.STRIPE_SECRET_KEY)) return null;
    const v = env.STRIPE_SECRET_KEY!.trim();
    if (v.startsWith("sk_live_")) return { name: "STRIPE_SECRET_KEY format", status: "pass", detail: "sk_live_… (production key)" };
    if (v.startsWith("sk_test_")) {
      return env.NODE_ENV === "production"
        ? { name: "STRIPE_SECRET_KEY format", status: "fail", detail: "sk_test_… (test key) used in production" }
        : { name: "STRIPE_SECRET_KEY format", status: "pass", detail: "sk_test_… (test key, non-prod)" };
    }
    if (v.startsWith("pk_")) return { name: "STRIPE_SECRET_KEY format", status: "fail", detail: "pasted publishable key (pk_…) — wrong key" };
    return { name: "STRIPE_SECRET_KEY format", status: "fail", detail: `unexpected prefix (got "${v.slice(0, 6)}…")` };
  },

  // Stripe webhook secret shape.
  (env) => {
    if (!isPresent(env.STRIPE_WEBHOOK_SECRET)) return null;
    const v = env.STRIPE_WEBHOOK_SECRET!.trim();
    if (v.startsWith("whsec_")) return { name: "STRIPE_WEBHOOK_SECRET format", status: "pass", detail: "whsec_…" };
    return { name: "STRIPE_WEBHOOK_SECRET format", status: "fail", detail: `expected whsec_… prefix (got "${v.slice(0, 6)}…")` };
  },

  // No same-value paste for the two Stripe secrets.
  (env) => {
    const sk = env.STRIPE_SECRET_KEY?.trim();
    const wh = env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!sk || !wh) return null;
    return sk === wh
      ? { name: "Stripe secrets distinct", status: "fail", detail: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are the same value" }
      : { name: "Stripe secrets distinct", status: "pass", detail: "" };
  },

  // DATABASE_URL parses as a postgres URL with a host.
  (env) => {
    if (!isPresent(env.DATABASE_URL)) return null;
    try {
      const u = new URL(env.DATABASE_URL!);
      if (!/^postgres(ql)?:$/.test(u.protocol)) {
        return { name: "DATABASE_URL format", status: "fail", detail: `expected postgres:// or postgresql:// (got "${u.protocol}")` };
      }
      if (!u.hostname) return { name: "DATABASE_URL format", status: "fail", detail: "no hostname in connection string" };
      return { name: "DATABASE_URL format", status: "pass", detail: `${u.protocol}//${u.hostname}…` };
    } catch {
      return { name: "DATABASE_URL format", status: "fail", detail: "not a valid URL" };
    }
  },

  // APP_URL: parseable, https in prod.
  (env) => {
    if (!isPresent(env.APP_URL)) return null;
    try {
      const u = new URL(env.APP_URL!);
      if (env.NODE_ENV === "production" && u.protocol !== "https:") {
        return { name: "APP_URL format", status: "fail", detail: `http:// in production — must be https (got "${env.APP_URL}")` };
      }
      return { name: "APP_URL format", status: "pass", detail: `${u.protocol}//${u.hostname}` };
    } catch {
      return { name: "APP_URL format", status: "fail", detail: "not a valid URL" };
    }
  },

  // SESSION_SECRET length sanity.
  (env) => {
    if (!isPresent(env.SESSION_SECRET)) return null;
    const v = env.SESSION_SECRET!.trim();
    if (v.length < 32) return { name: "SESSION_SECRET length", status: "fail", detail: `too short (${v.length} chars, need >= 32)` };
    if (/^(secret|password|changeme|todo)$/i.test(v)) {
      return { name: "SESSION_SECRET value", status: "fail", detail: `placeholder value ("${v}") — generate a real secret` };
    }
    return { name: "SESSION_SECRET length", status: "pass", detail: `${v.length} chars` };
  },

  // SENTRY_DSN parses if set.
  (env) => {
    if (!isPresent(env.SENTRY_DSN)) return null;
    try {
      const u = new URL(env.SENTRY_DSN!);
      if (!/^https?:$/.test(u.protocol)) {
        return { name: "SENTRY_DSN format", status: "fail", detail: `expected https:// (got "${u.protocol}")` };
      }
      if (!u.hostname.endsWith("sentry.io") && !u.hostname.endsWith("ingest.sentry.io")) {
        return { name: "SENTRY_DSN format", status: "warn", detail: `hostname "${u.hostname}" — not sentry.io, self-hosted?` };
      }
      return { name: "SENTRY_DSN format", status: "pass", detail: u.hostname };
    } catch {
      return { name: "SENTRY_DSN format", status: "fail", detail: "not a valid URL" };
    }
  },

  // CRM_WEBHOOK_SECRET length sanity.
  (env) => {
    if (!isPresent(env.CRM_WEBHOOK_SECRET)) return null;
    const v = env.CRM_WEBHOOK_SECRET!.trim();
    if (v.length < 16) return { name: "CRM_WEBHOOK_SECRET length", status: "fail", detail: `too short (${v.length} chars, need >= 16)` };
    return { name: "CRM_WEBHOOK_SECRET length", status: "pass", detail: `${v.length} chars` };
  },

  // Twilio account SID prefix sanity when dialer is enabled. Trim the
  // flag before checking so an operator who pastes "  false " doesn't
  // accidentally turn the dialer on.
  (env) => {
    const flag = env.FEATURE_DIALER?.trim();
    const dialerOn = !!flag && !/^(false|0|off|no)$/i.test(flag);
    if (!dialerOn) return null;
    if (!isPresent(env.TWILIO_ACCOUNT_SID)) return null; // env validator will catch the missing case
    const v = env.TWILIO_ACCOUNT_SID!.trim();
    return v.startsWith("AC")
      ? { name: "TWILIO_ACCOUNT_SID format", status: "pass", detail: "AC… (account SID)" }
      : { name: "TWILIO_ACCOUNT_SID format", status: "fail", detail: `expected AC… prefix (got "${v.slice(0, 4)}…")` };
  },

  // NODE_ENV explicitness — constrain to the canonical set so typos
  // like "prod" or "prduction" fail the deploy instead of being
  // silently treated as "not production".
  (env) => {
    if (!isPresent(env.NODE_ENV)) {
      return { name: "NODE_ENV explicitness", status: "warn", detail: "NODE_ENV unset — set explicitly ('production', 'development', or 'test')" };
    }
    const v = env.NODE_ENV!.trim();
    const allowed = new Set(["production", "development", "test"]);
    if (!allowed.has(v)) {
      return { name: "NODE_ENV explicitness", status: "fail", detail: `unrecognised value "${v}" — expected one of production / development / test (typo?)` };
    }
    return { name: "NODE_ENV explicitness", status: "pass", detail: v };
  },
];

export function runPredeployChecks(env: NodeJS.ProcessEnv = process.env): PreDeployResult {
  const envValidation = validateEnv(env);
  const checks: PreDeployCheck[] = [];
  for (const rule of FORMAT_RULES) {
    const result = rule(env);
    if (result) checks.push(result);
  }
  const anyFail = checks.some((c) => c.status === "fail") || envValidation.missing.length > 0;
  return {
    ok: !anyFail,
    isProd: envValidation.isProd,
    envValidation,
    checks,
  };
}

export function formatPredeployResult(result: PreDeployResult): string {
  const lines: string[] = [];
  lines.push(result.isProd ? "🚀 Pre-deploy check (production)" : "🛠  Pre-deploy check (non-prod)");
  lines.push("");

  // Env validator output first — that's the "missing required var" check.
  if (result.envValidation.missing.length > 0) {
    lines.push(`❌ ${result.envValidation.missing.length} required env var(s) missing:`);
    for (const m of result.envValidation.missing) lines.push(`   - ${m.key}: ${m.reason}`);
    lines.push("");
  } else {
    lines.push(`✅ all required env vars present (${result.envValidation.ruleCount} rules)`);
    lines.push("");
  }

  // Format checks.
  lines.push("Format & sanity checks:");
  for (const c of result.checks) {
    const icon = c.status === "pass" ? "✅" : c.status === "warn" ? "⚠️ " : "❌";
    lines.push(`  ${icon} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  lines.push("");

  // Env validator warnings (SENTRY_DSN unset etc.) — these are informational, not blocking.
  if (result.envValidation.warnings.length > 0) {
    lines.push("Warnings:");
    for (const w of result.envValidation.warnings) lines.push(`   - ${w}`);
    lines.push("");
  }

  lines.push(result.ok ? "✅ READY TO DEPLOY" : "❌ NOT READY — fix the items above");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const result = runPredeployChecks();
  console.log(formatPredeployResult(result));
  if (!result.ok) process.exit(1);
}

const entry = typeof process !== "undefined" ? process.argv[1] ?? "" : "";
if (entry.endsWith("predeploy-check.ts") || entry.endsWith("predeploy-check.js")) {
  void main();
}
