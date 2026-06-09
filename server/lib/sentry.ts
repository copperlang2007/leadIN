// Sentry wrapper. Wave 8 — observability scaffolding.
//
// Design goal: a tiny, stable API surface that we sprinkle through the
// server without forcing the rest of the codebase to depend on
// `@sentry/node` directly. When SENTRY_DSN is unset (dev, CI, tests),
// every export is a no-op so we never pay the cost of loading the SDK.
//
// When the DSN is set, we lazy-import the SDK on first init so test
// processes don't pull in a heavy dependency they don't need.
//
// Public API:
//   initSentry()                       — call once at process start
//   captureException(err, ctx?)        — record an error
//   captureMessage(msg, level?, ctx?)  — record a structured message
//
// All three are safe to call before `initSentry`; they become no-ops.

import type { Request } from "express";

export type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";

export interface SentryContext {
  req?: Request;
  userId?: string;
  tenantId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

let sdk: any = null;
let disabledLogged = false;
let initialized = false;

function logDisabledOnce(): void {
  if (disabledLogged) return;
  disabledLogged = true;
  // eslint-disable-next-line no-console
  console.log("[sentry] disabled — set SENTRY_DSN to enable");
}

function getDsn(): string | undefined {
  const dsn = process.env.SENTRY_DSN;
  return dsn && dsn.trim().length > 0 ? dsn : undefined;
}

export async function initSentry(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const dsn = getDsn();
  if (!dsn) {
    logDisabledOnce();
    return;
  }
  try {
    // Build the specifier dynamically so tsc doesn't try to resolve
     // @sentry/node at build time. The package is optional — when the
     // operator wants Sentry, they install it; otherwise we no-op.
    const specifier = "@sentry/node";
    const mod: any = await import(specifier).catch(() => null);
    if (!mod) {
      // eslint-disable-next-line no-console
      console.log("[sentry] @sentry/node not installed — running as no-op");
      return;
    }
    mod.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    });
    sdk = mod;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sentry] init failed:", err);
  }
}

function reqMeta(req: Request | undefined): Record<string, unknown> | undefined {
  if (!req) return undefined;
  return {
    method: req.method,
    url: req.originalUrl ?? req.url,
    requestId:
      (req as any).reqId ||
      (req.res?.locals as any)?.requestId ||
      undefined,
  };
}

function applyContext(scope: any, ctx: SentryContext | undefined): void {
  if (!ctx) return;
  if (ctx.userId || ctx.tenantId) {
    scope.setUser({ id: ctx.userId, tenantId: ctx.tenantId });
  }
  if (ctx.tags) {
    for (const [k, v] of Object.entries(ctx.tags)) scope.setTag(k, v);
  }
  const req = reqMeta(ctx.req);
  if (req) scope.setContext("request", req);
  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) scope.setExtra(k, v);
  }
}

export function captureException(err: unknown, ctx?: SentryContext): void {
  if (!sdk) return;
  try {
    sdk.withScope((scope: any) => {
      applyContext(scope, ctx);
      sdk.captureException(err);
    });
  } catch {
    // Never let Sentry crash us.
  }
}

export function captureMessage(
  msg: string,
  level: SentryLevel = "info",
  ctx?: SentryContext,
): void {
  if (!sdk) return;
  try {
    sdk.withScope((scope: any) => {
      scope.setLevel(level);
      applyContext(scope, ctx);
      sdk.captureMessage(msg);
    });
  } catch {
    // ignore
  }
}

export function __resetSentryForTests(): void {
  sdk = null;
  disabledLogged = false;
  initialized = false;
}

export function __isSentryActiveForTests(): boolean {
  return sdk !== null;
}
