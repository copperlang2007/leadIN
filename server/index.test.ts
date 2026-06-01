import { describe, it, expect } from "vitest";
import { buildAccessLog } from "./index";

// Each test asserts the redaction wiring on the access-log middleware. We
// drive the extracted `buildAccessLog` helper rather than spinning up express
// — the helper is exactly what the `res.on("finish", …)` handler calls, so
// covering it covers the wire.

function baseInput(captured: Record<string, any>) {
  return {
    reqId: "test-req",
    method: "POST",
    path: "/api/v1/leads/ingest",
    status: 200,
    durationMs: 12,
    capturedJsonResponse: captured,
  };
}

describe("buildAccessLog (access-log redaction wiring)", () => {
  it("redacts the canonical consumer keys (back-compat with the old 4-key set)", () => {
    const { fields } = buildAccessLog(
      baseInput({
        consumerName: "Jane Doe",
        consumerPhone: "415-867-5309",
        consumerEmail: "jane@example.com",
        consumerAddress: "123 Main St",
        type: "MA",
      }),
    );
    expect(fields.body).toEqual({
      consumerName: "[REDACTED]",
      consumerPhone: "[REDACTED]",
      consumerEmail: "[REDACTED]",
      consumerAddress: "[REDACTED]",
      type: "MA",
    });
  });

  it("redacts `ssn` and `dob` keys that the old set missed", () => {
    const { fields } = buildAccessLog(
      baseInput({ ssn: "123-45-6789", dob: "1980-01-01", type: "MA" }),
    );
    expect(fields.body.ssn).toBe("[REDACTED]");
    expect(fields.body.dob).toBe("[REDACTED]");
    expect(fields.body.type).toBe("MA");
  });

  it("redacts non-standard keys via substring match (customerSSN)", () => {
    const { fields } = buildAccessLog(
      baseInput({ customerSSN: "987654321", otherField: "ok" }),
    );
    expect(fields.body.customerSSN).toBe("[REDACTED]");
    expect(fields.body.otherField).toBe("ok");
  });

  it("redacts SSN-shaped values under unknown keys (notes: '123-45-6789')", () => {
    const { fields } = buildAccessLog(
      baseInput({ notes: "Consumer SSN is 123-45-6789", type: "MA" }),
    );
    expect(fields.body.notes).toBe("[REDACTED]");
    expect(fields.body.type).toBe("MA");
  });

  it("redacts phone-shaped values under unknown keys", () => {
    const { fields } = buildAccessLog(
      baseInput({ memo: "call back at (415) 867-5309", type: "MA" }),
    );
    expect(fields.body.memo).toBe("[REDACTED]");
    expect(fields.body.type).toBe("MA");
  });

  it("recursively redacts through nested objects and arrays", () => {
    const { fields } = buildAccessLog(
      baseInput({
        lead: {
          consumer: { firstName: "Jane", phone: "555-867-5309" },
          flags: [{ socialSecurity: "123-45-6789" }, { ok: "yes" }],
        },
      }),
    );
    expect(fields.body.lead.consumer.firstName).toBe("[REDACTED]");
    expect(fields.body.lead.consumer.phone).toBe("[REDACTED]");
    expect(fields.body.lead.flags[0].socialSecurity).toBe("[REDACTED]");
    expect(fields.body.lead.flags[1].ok).toBe("yes");
  });

  it("omits `body` entirely when no JSON response was captured", () => {
    const { fields, level } = buildAccessLog({
      reqId: "r",
      method: "GET",
      path: "/api/health",
      status: 204,
      durationMs: 2,
      capturedJsonResponse: undefined,
    });
    expect(fields.body).toBeUndefined();
    expect(level).toBe("info");
  });

  it("maps status codes to the right log level", () => {
    expect(buildAccessLog({ ...baseInput({}), status: 200 }).level).toBe("info");
    expect(buildAccessLog({ ...baseInput({}), status: 404 }).level).toBe("warn");
    expect(buildAccessLog({ ...baseInput({}), status: 500 }).level).toBe("error");
  });
});
