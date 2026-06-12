// PII-safe error formatter.
//
// 108 places in server/routes.ts (and counting) call console.error with
// the raw caught error. If an error message ever embeds consumer PII —
// e.g. `new Error("User with phone +1-555-1234 already exists")` from a
// duplicate-key violation, or a TrustedForm 4xx that quotes the lead's
// email — that data lands in stdout, Sentry, and any log shipper
// downstream. `redactPii` from shared/pii covers the structural case
// (objects with PII-named keys) but doesn't scrub the *string* of a
// raw error message.
//
// safeError takes anything throwable and returns a stable, JSON-safe
// shape with the message string scrubbed of SSN-shaped, phone-shaped,
// and email-shaped substrings. Non-Error throws (strings, numbers,
// undefined) get a sentinel.

const SSN_VALUE_RE = /\b\d{3}-?\d{2}-?\d{4}\b/g;
// US phone shapes. Note: no leading \b — that's a zero-width word
// boundary which DOESN'T match before `+`, so `+1-555-123-4567` would
// otherwise have its `+1` left intact. Trailing \b anchors the end so
// we don't gobble digits from longer numeric strings.
const PHONE_VALUE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
// Conservative email regex — matches typical addresses without trying
// to cover RFC edge cases. False negatives are fine here; we'd rather
// keep an unusual address than over-redact a legit error message.
const EMAIL_VALUE_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

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

/** Replace SSN-shaped, phone-shaped, and email-shaped substrings with [REDACTED]. */
export function redactPiiString(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;
  return input
    .replace(SSN_VALUE_RE, "[REDACTED]")
    .replace(PHONE_VALUE_RE, "[REDACTED]")
    .replace(EMAIL_VALUE_RE, "[REDACTED]");
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
