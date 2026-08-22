// Production env validator.
//
// Run at boot to refuse to start with a half-configured prod environment.
// In non-prod, we still do the check but only surface diagnostics — useful
// in CI and when running `npm run dev` against a live staging DB.
//
// Strategy: a small, declarative rules table keyed by env var. Each rule
// says whether the var is required in prod and, optionally, what other
// vars it forces (e.g. enabling FEATURE_DIALER pulls TWILIO_* into the
// required set). The validator returns a structured result so it can be
// invoked from boot or a CLI without surprises.
//
// Lives under server/lib so it's included in the tsc build graph; the
// CLI at scripts/validate-prod-env.ts is a thin re-export wrapper.

export interface EnvRule {
  key: string;
  // Always required when NODE_ENV === "production".
  requiredInProd?: boolean;
  // When this env var is set to a non-empty value, the listed keys also
  // become required. Used for feature-flag → API-key coupling.
  requires?: { whenSet: string; keys: string[] };
  // Free-form note shown in the failure message.
  note?: string;
}

export const PROD_ENV_RULES: EnvRule[] = [
  { key: "DATABASE_URL", requiredInProd: true, note: "Postgres connection string" },
  { key: "SESSION_SECRET", requiredInProd: true, note: "session cookie HMAC key" },
  { key: "APP_URL", requiredInProd: true, note: "canonical public URL — prevents host-header spoofing" },
  { key: "STRIPE_SECRET_KEY", requiredInProd: true, note: "Stripe server key" },
  { key: "STRIPE_WEBHOOK_SECRET", requiredInProd: true, note: "Stripe webhook signing secret" },
  { key: "CRM_WEBHOOK_SECRET", requiredInProd: true, note: "HMAC secret for inbound CRM webhooks (X-LCP-Signature)" },
  { key: "STRIPE_PRICE_STARTER", requiredInProd: true, note: "Stripe price id for Starter plan" },
  { key: "STRIPE_PRICE_GROWTH", requiredInProd: true, note: "Stripe price id for Growth plan" },
  { key: "STRIPE_PRICE_SCALE", requiredInProd: true, note: "Stripe price id for Scale plan" },
  {
    key: "FEATURE_DIALER",
    requires: { whenSet: "FEATURE_DIALER", keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"] },
    note: "dialer requires Twilio credentials",
  },
  {
    key: "FEATURE_DNC_VENDOR",
    requires: { whenSet: "FEATURE_DNC_VENDOR", keys: ["DNC_VENDOR_API_URL", "DNC_VENDOR_API_KEY"] },
    note: "DNC vendor lookup requires API credentials",
  },
  {
    key: "FEATURE_NIPR",
    requires: { whenSet: "FEATURE_NIPR", keys: ["NIPR_API_KEY"] },
    note: "NIPR license check requires API key",
  },
  {
    key: "MCF_URL",
    requires: { whenSet: "MCF_URL", keys: ["MCF_SERVICE_SECRET"] },
    note: "MedicareCallForge integration requires the HMAC service secret (ADR-0002)",
  },
];

export interface ValidationResult {
  ok: boolean;
  isProd: boolean;
  ruleCount: number;
  missing: Array<{ key: string; reason: string }>;
  warnings: string[];
}

function isTruthyEnv(v: string | undefined): boolean {
  if (v === undefined) return false;
  const t = v.trim();
  if (t === "") return false;
  // Treat literal "false" / "0" as off — matches how feature flags are read elsewhere.
  if (/^(false|0|off|no)$/i.test(t)) return false;
  return true;
}

function isPresent(v: string | undefined): boolean {
  return v !== undefined && v.trim() !== "";
}

export function validateEnv(
  env: NodeJS.ProcessEnv = process.env,
  rules: EnvRule[] = PROD_ENV_RULES,
): ValidationResult {
  const isProd = env.NODE_ENV === "production";
  const missing: ValidationResult["missing"] = [];
  const warnings: string[] = [];

  for (const rule of rules) {
    if (rule.requiredInProd && isProd && !isPresent(env[rule.key])) {
      missing.push({ key: rule.key, reason: rule.note ?? "required in production" });
    }
    if (rule.requires && isTruthyEnv(env[rule.requires.whenSet])) {
      for (const dep of rule.requires.keys) {
        if (!isPresent(env[dep])) {
          missing.push({
            key: dep,
            reason: `required when ${rule.requires.whenSet} is enabled — ${rule.note ?? ""}`.trim(),
          });
        }
      }
    }
  }

  if (isProd && !isPresent(env.SENTRY_DSN)) {
    warnings.push("SENTRY_DSN unset — error reporting will be silently disabled in production.");
  }
  if (!isPresent(env.REDIS_URL)) {
    warnings.push("REDIS_URL unset — rate limiter will fall back to in-memory (not safe across instances).");
  }

  // Neon Auth (Stack). These are deliberately NOT requiredInProd: server/neonAuth.ts
  // documents "unset = auth off" as the dev/CI posture, and making them hard
  // requirements would change that contract. But a production deploy where the
  // sign-in handshake is dead boots perfectly green and looks healthy — the
  // exchange endpoint just 503s and every guarded route 401s — so silence here
  // is the wrong default. Warn instead, naming the user-visible consequence.
  //
  // Both VITE_-prefixed values are baked into the client bundle at build time,
  // so setting them only at runtime is not enough: the host must have them
  // present for the build that produces the bundle.
  if (isProd) {
    const hasProjectId = isPresent(env.VITE_STACK_PROJECT_ID);
    const hasClientKey = isPresent(env.VITE_STACK_PUBLISHABLE_CLIENT_KEY);
    if (!hasProjectId && !hasClientKey) {
      warnings.push(
        "VITE_STACK_PROJECT_ID and VITE_STACK_PUBLISHABLE_CLIENT_KEY unset — Neon Auth is off: " +
          "/auth shows a config notice, POST /api/auth/session returns 503, and every guarded route 401s. " +
          "No one can sign in to this deployment.",
      );
    } else if (!hasProjectId) {
      // Half-configured is the insidious case: the SPA renders a working
      // sign-in form, the user authenticates with Stack, and only the
      // server-side exchange fails.
      warnings.push(
        "VITE_STACK_PROJECT_ID unset while VITE_STACK_PUBLISHABLE_CLIENT_KEY is set — sign-in will render " +
          "but POST /api/auth/session returns 503, so no session is ever created.",
      );
    } else if (!hasClientKey) {
      warnings.push(
        "VITE_STACK_PUBLISHABLE_CLIENT_KEY unset while VITE_STACK_PROJECT_ID is set — the client SDK is null, " +
          "so /auth renders a config notice and no sign-in is possible.",
      );
    }
  }

  return { ok: missing.length === 0, isProd, ruleCount: rules.length, missing, warnings };
}

export function formatResult(result: ValidationResult): string {
  const lines: string[] = [];
  lines.push(result.isProd ? "🔒 Production env check" : "🛠  Non-prod env check");
  if (result.missing.length === 0) {
    lines.push(`✅ all required env vars present (${result.ruleCount} rules evaluated)`);
  } else {
    lines.push(`❌ ${result.missing.length} missing:`);
    for (const m of result.missing) lines.push(`   - ${m.key}: ${m.reason}`);
  }
  if (result.warnings.length > 0) {
    lines.push("⚠️  warnings:");
    for (const w of result.warnings) lines.push(`   - ${w}`);
  }
  return lines.join("\n");
}
