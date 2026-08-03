// Lead contact-field validation — pure helpers, no I/O.
//
// A marketplace lead is only as good as its contact data. These helpers run at
// ingest so junk contacts are rejected at the door instead of scored, sold,
// and disputed. Kept DB-free so the rules are unit-testable and reusable by
// the dedup query (which compares NORMALIZED phones, not raw vendor strings).

/**
 * Normalize a phone string to a bare 10-digit NANP number, or null when it
 * cannot be a valid US/CA number. Accepts any formatting ("(555) 123-4567",
 * "+1 555.123.4567", "15551234567") and enforces NANP structure: area code and
 * exchange must both start with 2-9. Rejects obvious junk like all-same-digit
 * numbers and 555-01xx fictional ranges are allowed (they're valid NANP and
 * legitimately appear in test traffic; DNC and dial outcomes catch the rest).
 */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP: N (2-9) for area-code and exchange leading digits.
  if (digits[0] < "2" || digits[3] < "2") return null;
  // All ten digits identical is never a real subscriber number.
  if (/^(\d)\1{9}$/.test(digits)) return null;
  return digits;
}

// Disposable / throwaway email domains. Deliberately a small, high-precision
// list: every entry is a dedicated disposable-mail service, so a hit is
// unambiguous junk. Growable without a schema change.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "10minutemail.com",
  "yopmail.com",
  "tempmail.com",
  "temp-mail.org",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "fakeinbox.com",
  "throwawaymail.com",
  "mintemail.com",
]);

export interface EmailQuality {
  /** Structurally plausible (has local part, @, and a dotted domain). */
  valid: boolean;
  /** Domain is a known disposable-mail service. */
  disposable: boolean;
}

/**
 * Assess an email's quality. Zod's `.email()` already gates structure at the
 * schema layer; this adds the disposable-domain check that structure alone
 * can't catch. Case-insensitive on the domain.
 */
export function assessEmail(email: string | undefined | null): EmailQuality {
  if (!email) return { valid: false, disposable: false };
  const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim());
  if (!match) return { valid: false, disposable: false };
  const domain = match[1].toLowerCase();
  return { valid: true, disposable: DISPOSABLE_DOMAINS.has(domain) };
}
