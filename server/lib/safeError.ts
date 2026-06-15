// PII-safe error formatter.
//
// 108 places in server/routes.ts (and counting) call console.error with
// the raw caught error. If an error message ever embeds consumer PII —
// e.g. `new Error("User with phone +1-555-1234 already exists")` from a
// duplicate-key violation, or a TrustedForm 4xx that quotes the lead's
// email — that data lands in stdout, Sentry, and any log shipper
// downstream.
//
// safeError takes anything throwable and returns a stable, JSON-safe
// shape with the message string scrubbed of SSN-shaped, phone-shaped,
// and email-shaped substrings via the shared `redactPiiString` helper.
// Single source of truth for PII patterns lives in @shared/pii so the
// structural (`redactPii`) and free-text (`redactPiiString`) redactors
// can't drift.

import { redactPiiString } from "@shared/pii";

// Re-exported so existing callers / tests don't have to change their
// import paths after the centralisation.
export { redactPiiString };

export interface SafeError {
  name: string;
  message: string;
  // stack is only included in non-prod and only when explicitly opted in
  // by the caller. Production logs ship to Sentry which keeps its own
  // stack via captureException; double-logging it bloats stdout and is
  // the most common vector for stack-embedded PII (e.g. a hostname or
  // file path containing a user id).
  stack?: string;
}

/**
 * Log a redacted error with a context label. Centralises the
 * `console.error("scenario:", safeError(err))` pattern that repeats
 * hundreds of times across the server — having one helper means
 * future logging-policy changes (structured logger, Sentry
 * breadcrumb, log level routing) land in one place.
 */
export function logError(context: string, err: unknown): void {
  console.error(context, safeError(err));
}

/**
 * Turn anything throwable into a JSON-safe `{name, message}` (optionally
 * with `stack`). PII in the message is scrubbed.
 *
 * Non-Error throws — strings, numbers, undefined, null — get a stable
 * `{name: "NonError", message: "<stringified value>"}` envelope so log
 * shape stays consistent.
 */
export function safeError(err: unknown, opts: { includeStack?: boolean } = {}): SafeError {
  if (err instanceof Error) {
    const out: SafeError = {
      name: err.name || "Error",
      message: redactPiiString(err.message ?? ""),
    };
    if (opts.includeStack && err.stack) {
      out.stack = redactPiiString(err.stack);
    }
    return out;
  }
  // Strings, numbers, plain objects, null, undefined.
  let stringified: string;
  if (err === null) stringified = "null";
  else if (err === undefined) stringified = "undefined";
  else if (typeof err === "string") stringified = err;
  else if (typeof err === "number" || typeof err === "boolean") stringified = String(err);
  else {
    try {
      stringified = JSON.stringify(err);
    } catch {
      stringified = "[unserialisable]";
    }
  }
  return {
    name: "NonError",
    message: redactPiiString(stringified),
  };
}
