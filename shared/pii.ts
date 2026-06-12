// Centralized PII key registry. Single source of truth so log redaction,
// CSV export, and GDPR delete don't drift apart.
//
// Includes both:
//   - Exact keys we control (consumerName, ssn, dob, …)
//   - Substring patterns for fields we don't control (e.g., a vendor
//     might post `customerSSN` — we still want to redact it).

export const PII_KEYS_EXACT = new Set<string>([
  "consumerName",
  "consumerPhone",
  "consumerEmail",
  "consumerAddress",
  "firstName",
  "lastName",
  "fullName",
  "phone",
  "email",
  "address",
  "ssn",
  "socialSecurityNumber",
  "dob",
  "dateOfBirth",
  "driversLicense",
]);

// Lowercase substring matches — `key.toLowerCase().includes(p)` triggers redaction.
export const PII_KEY_PATTERNS = [
  "ssn",
  "social",
  "passport",
  "license",
  "creditcard",
  "cardnumber",
  "cvv",
  "iban",
  "routingnumber",
  "accountnumber",
];

// SSN-shaped values (with or without dashes). Detection (no `g` flag).
const SSN_VALUE_RE = /\b\d{3}-?\d{2}-?\d{4}\b/;
// US phone shapes. Detection (no `g` flag).
// Note: no leading \b — \b doesn't match before `+`, so `+1-555-…` would
// otherwise have its `+1` left intact. Trailing \b anchors the end so
// we don't gobble digits from longer numeric strings.
const PHONE_VALUE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;

// Global versions for *string scrubbing* — replace every occurrence in a
// sentence rather than just detecting one. Kept here so the structural
// redactor and the free-text redactor never drift in their definition of
// what looks like SSN/phone/email.
const SSN_VALUE_RE_G = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const PHONE_VALUE_RE_G = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
// Conservative email regex — matches typical addresses without trying
// to cover RFC edge cases. False negatives are fine here; we'd rather
// keep an unusual address than over-redact a legit error message.
const EMAIL_VALUE_RE_G = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

export function isPiiKey(key: string): boolean {
  if (PII_KEYS_EXACT.has(key)) return true;
  const lower = key.toLowerCase();
  return PII_KEY_PATTERNS.some(p => lower.includes(p));
}

// Returns true if a string value looks like PII regardless of its key.
export function looksLikePiiValue(value: string): boolean {
  if (value.length > 200) return false; // skip huge strings — too expensive
  return SSN_VALUE_RE.test(value) || PHONE_VALUE_RE.test(value);
}

/**
 * Replace SSN-, US-phone-, and email-shaped substrings in a free-form
 * string with [REDACTED]. Used by safeError to scrub Error.message
 * before logs / Sentry. Stays consistent with looksLikePiiValue so the
 * structural and string redactors agree on what counts as PII.
 */
export function redactPiiString(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;
  return input
    .replace(SSN_VALUE_RE_G, "[REDACTED]")
    .replace(PHONE_VALUE_RE_G, "[REDACTED]")
    .replace(EMAIL_VALUE_RE_G, "[REDACTED]");
}

// Recursive structural redactor. Returns a new object — never mutates.
export function redactPii(obj: any): any {
  if (Array.isArray(obj)) return obj.map(redactPii);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isPiiKey(k)) {
        out[k] = "[REDACTED]";
      } else if (typeof v === "string" && looksLikePiiValue(v)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactPii(v);
      }
    }
    return out;
  }
  return obj;
}
