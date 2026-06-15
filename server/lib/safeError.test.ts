import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeError, redactPiiString, logError } from "./safeError";

describe("redactPiiString", () => {
  it("strips SSN-shaped substrings", () => {
    expect(redactPiiString("user 123-45-6789 not found")).toBe("user [REDACTED] not found");
    expect(redactPiiString("ssn=123456789")).toBe("ssn=[REDACTED]");
  });

  it("strips phone-shaped substrings (US shapes)", () => {
    expect(redactPiiString("Phone +1-555-123-4567 already exists")).toBe(
      "Phone [REDACTED] already exists",
    );
    expect(redactPiiString("(555) 123-4567 conflict")).toBe("[REDACTED] conflict");
    expect(redactPiiString("5551234567 conflict")).toBe("[REDACTED] conflict");
  });

  it("strips email-shaped substrings", () => {
    expect(redactPiiString("user jane.doe@example.com already exists")).toBe(
      "user [REDACTED] already exists",
    );
  });

  it("strips MULTIPLE occurrences in one string (global regex)", () => {
    const input = "duplicate: user@a.com, user@b.com";
    expect(redactPiiString(input)).toBe("duplicate: [REDACTED], [REDACTED]");
  });

  it("leaves non-PII strings alone", () => {
    expect(redactPiiString("connection refused at db:5432")).toBe(
      "connection refused at db:5432",
    );
    // Order id alone isn't PII — must not over-redact.
    expect(redactPiiString("order 42 not found")).toBe("order 42 not found");
  });

  it("handles empty + non-string defensively", () => {
    expect(redactPiiString("")).toBe("");
    // Documentation: callers must pass strings; if they don't, return as-is.
    expect(redactPiiString(undefined as unknown as string)).toBeUndefined();
  });
});

describe("logError — convenience wrapper around safeError + console.error", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("calls console.error with the context label and a redacted error shape", () => {
    logError("Failed to fetch:", new Error("User phone +1-555-123-4567 boom"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("Failed to fetch:", {
      name: "Error",
      message: "User phone [REDACTED] boom",
    });
  });

  it("wraps non-Error throws (string) into the NonError envelope", () => {
    logError("Top-level:", "bare string thrown");
    expect(spy).toHaveBeenCalledWith("Top-level:", {
      name: "NonError",
      message: "bare string thrown",
    });
  });
});

describe("safeError", () => {
  it("wraps a plain Error with name + message", () => {
    const r = safeError(new Error("boom"));
    expect(r).toEqual({ name: "Error", message: "boom" });
  });

  it("preserves subclass names (TypeError, RangeError, …)", () => {
    expect(safeError(new TypeError("bad"))).toEqual({ name: "TypeError", message: "bad" });
  });

  it("scrubs PII in Error.message (the headline use case)", () => {
    const err = new Error("User with phone +1-555-123-4567 already exists");
    expect(safeError(err).message).toBe("User with phone [REDACTED] already exists");
  });

  it("scrubs PII in stack ONLY when includeStack=true is opted in", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n  at handler (file.ts:1:1) user=jane@example.com";
    const withoutStack = safeError(err);
    expect(withoutStack.stack).toBeUndefined();
    const withStack = safeError(err, { includeStack: true });
    expect(withStack.stack).toContain("[REDACTED]");
    expect(withStack.stack).not.toContain("jane@example.com");
  });

  it("wraps string throws", () => {
    expect(safeError("oh no")).toEqual({ name: "NonError", message: "oh no" });
  });

  it("wraps number / boolean throws", () => {
    expect(safeError(42)).toEqual({ name: "NonError", message: "42" });
    expect(safeError(false)).toEqual({ name: "NonError", message: "false" });
  });

  it("wraps null + undefined throws (don't crash the logger)", () => {
    expect(safeError(null)).toEqual({ name: "NonError", message: "null" });
    expect(safeError(undefined)).toEqual({ name: "NonError", message: "undefined" });
  });

  it("wraps plain-object throws via JSON.stringify, scrubbing PII inside", () => {
    const r = safeError({ kind: "dupe", offending: "jane@example.com" });
    expect(r.name).toBe("NonError");
    expect(r.message).toContain("[REDACTED]");
    expect(r.message).not.toContain("jane@example.com");
  });

  it("survives circular references (JSON.stringify would throw)", () => {
    const circ: any = { kind: "loop" };
    circ.self = circ;
    const r = safeError(circ);
    expect(r).toEqual({ name: "NonError", message: "[unserialisable]" });
  });

  it("safeError(error).message and redactPiiString agree for Error inputs", () => {
    const raw = "Phone 555-123-4567 + ssn 123-45-6789 + jane@a.com all leak";
    expect(safeError(new Error(raw)).message).toBe(redactPiiString(raw));
  });
});
