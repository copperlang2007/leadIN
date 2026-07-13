// Agent Referrals (N2) — pure helpers.
//
// This module holds the small, side-effect-free pieces of the referral
// feature: code generation, code validation, and the reward amount. Keeping
// them here (rather than inside storage.ts) means they are trivially unit
// testable without a database, mirroring how reputation.ts splits its pure
// aggregation helpers from the storage layer.

import { randomBytes, createHash } from "crypto";

// Unambiguous, URL-safe alphabet: no 0/O, no 1/I/L (which read as each other
// in shared links and hand-typed codes). 31 symbols — 8 digits + 23 letters.
export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_LENGTH = 8;

// A valid code is a run of alphabet characters of the length we mint. We accept
// a small range (6–12) so the validator stays forgiving of any future length
// tweak while still rejecting obvious junk. Built from the alphabet constant so
// the regex can never drift out of sync with what we generate.
const REFERRAL_CODE_RE = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{6,12}$`);

/**
 * Reward granted to BOTH the referrer and the referred agent when the referred
 * user makes their first purchase. Denominated in cents. Env-overridable via
 * REFERRAL_REWARD_CENTS; falls back to 500 ($5) when unset or invalid.
 */
export const REFERRAL_REWARD_CENTS: number = (() => {
  const raw = process.env.REFERRAL_REWARD_CENTS;
  if (raw !== undefined && raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 500;
})();

/**
 * Produce a short, URL-safe, unambiguous referral code. Optionally mixes a
 * caller-supplied `seed` (e.g. the referrer's user id) into the entropy so
 * codes are well-distributed even if the CSPRNG is being exercised heavily.
 * The output is always fresh random material — the seed only perturbs it, it
 * does not make the code guessable from the seed alone.
 */
export function generateReferralCode(seed?: string): string {
  // 32 bytes of CSPRNG entropy, folded together with a hash of the seed so the
  // per-caller component contributes without ever being reconstructable.
  const rnd = randomBytes(REFERRAL_CODE_LENGTH * 2);
  const seedDigest = createHash("sha256")
    .update(seed ?? "")
    .update(randomBytes(8))
    .digest();

  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    // XOR a random byte with a seed-derived byte, then map into the alphabet.
    const b = rnd[i] ^ seedDigest[i % seedDigest.length];
    out += REFERRAL_CODE_ALPHABET[b % REFERRAL_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Validate a referral code's shape. Rejects non-strings, wrong length, and any
 * character outside the unambiguous alphabet. Does NOT check existence — that
 * is a storage concern.
 */
export function isValidReferralCode(code: unknown): code is string {
  return typeof code === "string" && REFERRAL_CODE_RE.test(code);
}
