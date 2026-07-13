import { describe, it, expect } from "vitest";
import {
  generateReferralCode,
  isValidReferralCode,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REWARD_CENTS,
} from "./referrals";

describe("generateReferralCode", () => {
  it("produces a code of the expected length", () => {
    expect(generateReferralCode("user_1")).toHaveLength(REFERRAL_CODE_LENGTH);
  });

  it("uses only unambiguous alphabet characters (no 0/O/1/I/L)", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateReferralCode(`seed_${i}`);
      for (const ch of code) {
        expect(REFERRAL_CODE_ALPHABET).toContain(ch);
      }
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it("always returns a self-validating code", () => {
    for (let i = 0; i < 200; i++) {
      expect(isValidReferralCode(generateReferralCode())).toBe(true);
    }
  });

  it("does not return the same code across many draws (probabilistically unique)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateReferralCode("stable-seed"));
    // 31^8 space — collisions across 1000 draws are astronomically unlikely.
    expect(seen.size).toBe(1000);
  });

  it("is not deterministic from the seed alone", () => {
    const a = generateReferralCode("same-seed");
    const b = generateReferralCode("same-seed");
    expect(a).not.toBe(b);
  });
});

describe("isValidReferralCode", () => {
  it("accepts a freshly generated code", () => {
    expect(isValidReferralCode(generateReferralCode())).toBe(true);
  });

  it("accepts a hand-written code within the length range", () => {
    expect(isValidReferralCode("ABCD2345")).toBe(true);
  });

  it("rejects non-strings", () => {
    expect(isValidReferralCode(undefined)).toBe(false);
    expect(isValidReferralCode(null)).toBe(false);
    expect(isValidReferralCode(12345678)).toBe(false);
    expect(isValidReferralCode({})).toBe(false);
    expect(isValidReferralCode(["ABCD2345"])).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidReferralCode("")).toBe(false);
  });

  it("rejects codes that are too short or too long", () => {
    expect(isValidReferralCode("ABC23")).toBe(false); // 5
    expect(isValidReferralCode("ABCDEFGHJKMNP")).toBe(false); // 13
  });

  it("rejects ambiguous / out-of-alphabet characters", () => {
    expect(isValidReferralCode("ABCD0234")).toBe(false); // 0
    expect(isValidReferralCode("ABCD1234")).toBe(false); // 1
    expect(isValidReferralCode("ABCDO234")).toBe(false); // O
    expect(isValidReferralCode("ABCDI234")).toBe(false); // I
    expect(isValidReferralCode("ABCDL234")).toBe(false); // L
    expect(isValidReferralCode("abcd2345")).toBe(false); // lowercase
    expect(isValidReferralCode("ABCD-234")).toBe(false); // punctuation
  });
});

describe("REFERRAL_REWARD_CENTS", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(REFERRAL_REWARD_CENTS)).toBe(true);
    expect(REFERRAL_REWARD_CENTS).toBeGreaterThan(0);
  });

  it("defaults to 500 ($5) when the env override is unset", () => {
    // The suite runs without REFERRAL_REWARD_CENTS set, so the default applies.
    if (!process.env.REFERRAL_REWARD_CENTS) {
      expect(REFERRAL_REWARD_CENTS).toBe(500);
    }
  });
});
