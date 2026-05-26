// Structured logger. Emits JSON in production (one event per line, easy to
// ship to Loki/Datadog/CloudWatch) and a readable text format in dev.
//
// Pino was the obvious choice but it's a heavy dep; this is the 80% of
// pino we actually use, in 60 lines, zero dependencies.

import crypto from "crypto";

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;
const PROD = process.env.NODE_ENV === "production";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return;
  const base = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(fields ?? {}),
  };
  if (PROD) {
    // One JSON line — ideal for any log shipper.
    console.log(JSON.stringify(base));
    return;
  }
  // Human-friendly in dev. Include the fields trailer if any.
  const tail = fields && Object.keys(fields).length
    ? " " + Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")
    : "";
  console.log(`${base.t} [${level}] ${msg}${tail}`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
  child: (defaults: Record<string, unknown>) => ({
    debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, { ...defaults, ...f }),
    info: (m: string, f?: Record<string, unknown>) => emit("info", m, { ...defaults, ...f }),
    warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, { ...defaults, ...f }),
    error: (m: string, f?: Record<string, unknown>) => emit("error", m, { ...defaults, ...f }),
  }),
};

export function newRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}
