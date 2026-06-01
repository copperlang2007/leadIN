import { describe, it, expect } from "vitest";
import { isPiiKey, looksLikePiiValue, redactPii } from "./pii";

describe("isPiiKey", () => {
  it("catches the canonical consumer keys", () => {
    expect(isPiiKey("consumerName")).toBe(true);
    expect(isPiiKey("consumerPhone")).toBe(true);
    expect(isPiiKey("consumerEmail")).toBe(true);
    expect(isPiiKey("consumerAddress")).toBe(true);
  });

  it("catches generic identity keys", () => {
    expect(isPiiKey("firstName")).toBe(true);
    expect(isPiiKey("dob")).toBe(true);
    expect(isPiiKey("ssn")).toBe(true);
  });

  it("catches custom keys via substring patterns", () => {
    expect(isPiiKey("customerSSN")).toBe(true);
    expect(isPiiKey("driverLicense")).toBe(true);
    expect(isPiiKey("PayCardNumber")).toBe(true);
    expect(isPiiKey("routingNumber")).toBe(true);
  });

  it("ignores benign keys", () => {
    expect(isPiiKey("type")).toBe(false);
    expect(isPiiKey("state")).toBe(false);
    expect(isPiiKey("vendorId")).toBe(false);
  });
});

describe("looksLikePiiValue", () => {
  it("matches SSN-shaped values", () => {
    expect(looksLikePiiValue("123-45-6789")).toBe(true);
    expect(looksLikePiiValue("123456789")).toBe(true);
  });

  it("matches phone-shaped values", () => {
    expect(looksLikePiiValue("(415) 867-5309")).toBe(true);
    expect(looksLikePiiValue("415.867.5309")).toBe(true);
    expect(looksLikePiiValue("+1 415 867 5309")).toBe(true);
  });

  it("ignores ordinary strings", () => {
    expect(looksLikePiiValue("Medicare Advantage")).toBe(false);
    expect(looksLikePiiValue("FL")).toBe(false);
  });

  it("skips huge strings to avoid pathological regex cost", () => {
    expect(looksLikePiiValue("a".repeat(1000))).toBe(false);
  });
});

describe("redactPii", () => {
  it("redacts known keys at every depth", () => {
    const out = redactPii({
      type: "MA",
      consumer: { firstName: "Jane", phone: "415-867-5309" },
      meta: [{ ssn: "123-45-6789" }, { other: "ok" }],
    });
    expect(out).toEqual({
      type: "MA",
      consumer: { firstName: "[REDACTED]", phone: "[REDACTED]" },
      meta: [{ ssn: "[REDACTED]" }, { other: "ok" }],
    });
  });

  it("redacts unknown keys when the value looks like PII", () => {
    const out = redactPii({ randomField: "415-867-5309" });
    expect(out.randomField).toBe("[REDACTED]");
  });

  it("returns a new object — does not mutate input", () => {
    const input: any = { consumerPhone: "555-0123" };
    const out = redactPii(input);
    expect(input.consumerPhone).toBe("555-0123");
    expect(out.consumerPhone).toBe("[REDACTED]");
  });
});
