import { describe, expect, it } from "vitest";
import { assessEmail, normalizePhone } from "./leadValidation";

describe("normalizePhone", () => {
  it("normalizes common formats to bare 10 digits", () => {
    expect(normalizePhone("(555) 234-5678")).toBe("5552345678");
    expect(normalizePhone("555.234.5678")).toBe("5552345678");
    expect(normalizePhone("555-234-5678")).toBe("5552345678");
    expect(normalizePhone("5552345678")).toBe("5552345678");
  });

  it("strips a leading country code 1", () => {
    expect(normalizePhone("+1 555 234 5678")).toBe("5552345678");
    expect(normalizePhone("15552345678")).toBe("5552345678");
  });

  it("rejects wrong lengths", () => {
    expect(normalizePhone("555234567")).toBeNull();      // 9 digits
    expect(normalizePhone("55523456789")).toBeNull();    // 11, not 1-prefixed
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("rejects invalid NANP structure", () => {
    expect(normalizePhone("1552345678")).toBeNull();  // area code starts with 1
    expect(normalizePhone("0552345678")).toBeNull();  // area code starts with 0
    expect(normalizePhone("5551345678")).toBeNull();  // exchange starts with 1
    expect(normalizePhone("5550345678")).toBeNull();  // exchange starts with 0
  });

  it("rejects all-identical-digit numbers", () => {
    expect(normalizePhone("5555555555")).toBeNull();
    expect(normalizePhone("9999999999")).toBeNull();
  });

  it("treats differently-formatted same numbers identically (dedup contract)", () => {
    expect(normalizePhone("(555) 234-5678")).toBe(normalizePhone("+1-555-234-5678"));
  });
});

describe("assessEmail", () => {
  it("accepts a normal address", () => {
    expect(assessEmail("jane@example.com")).toEqual({ valid: true, disposable: false });
  });

  it("flags disposable domains, case-insensitively", () => {
    expect(assessEmail("x@mailinator.com")).toEqual({ valid: true, disposable: true });
    expect(assessEmail("x@MAILINATOR.COM")).toEqual({ valid: true, disposable: true });
    expect(assessEmail("x@yopmail.com").disposable).toBe(true);
  });

  it("rejects structural junk", () => {
    expect(assessEmail("not-an-email").valid).toBe(false);
    expect(assessEmail("a@b").valid).toBe(false);          // no dotted domain
    expect(assessEmail("a b@example.com").valid).toBe(false);
    expect(assessEmail("").valid).toBe(false);
    expect(assessEmail(undefined).valid).toBe(false);
  });

  it("does not flag lookalike but legitimate domains", () => {
    expect(assessEmail("x@gmail.com").disposable).toBe(false);
    expect(assessEmail("x@tempmail.com.example.com").disposable).toBe(false);
  });
});
