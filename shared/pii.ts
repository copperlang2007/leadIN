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

// SSN-shaped values (with or without dashes).
const SSN_VALUE_RE = /\b\d{3}-?\d{2}-?\d{4}\b/;
// US phone shapes.
const PHONE_VALUE_RE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;

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
