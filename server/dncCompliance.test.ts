import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkDnc } from "./dncCompliance";

describe("checkDnc", () => {
  it("returns skip for missing or short phones", async () => {
    expect((await checkDnc(undefined)).source).toBe("skip");
    expect((await checkDnc("")).source).toBe("skip");
    expect((await checkDnc("123")).source).toBe("skip");
  });

  it("flags local-suppression suffixes in fallback mode", async () => {
    delete process.env.DNC_VENDOR_API_KEY;
    delete process.env.DNC_VENDOR_API_URL;
    const r = await checkDnc("555-555-0000");
    expect(r.flagged).toBe(true);
    expect(r.source).toBe("local-fallback");
  });

  it("does not flag normal phones in fallback mode", async () => {
    delete process.env.DNC_VENDOR_API_KEY;
    delete process.env.DNC_VENDOR_API_URL;
    const r = await checkDnc("415-555-2671");
    expect(r.flagged).toBe(false);
  });

  it("normalises punctuation", async () => {
    const r = await checkDnc("(415) 867-5309");
    expect(r.source).toBe("local-fallback");
    expect(r.flagged).toBe(false);
  });
});

describe("checkDnc live vendor fails closed", () => {
  let savedKey: string | undefined;
  let savedUrl: string | undefined;
  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    savedKey = process.env.DNC_VENDOR_API_KEY;
    savedUrl = process.env.DNC_VENDOR_API_URL;
    process.env.DNC_VENDOR_API_KEY = "test-key";
    process.env.DNC_VENDOR_API_URL = "https://dnc.example/check";
    savedFetch = global.fetch;
  });

  afterEach(() => {
    if (savedKey !== undefined) process.env.DNC_VENDOR_API_KEY = savedKey;
    else delete process.env.DNC_VENDOR_API_KEY;
    if (savedUrl !== undefined) process.env.DNC_VENDOR_API_URL = savedUrl;
    else delete process.env.DNC_VENDOR_API_URL;
    global.fetch = savedFetch;
  });

  it("returns flagged=true with source=vendor-error on a 5xx response", async () => {
    // Regression: a vendor 504 used to return { flagged: false } with
    // source="vendor", which silently green-lit any number through
    // the DNC gate. That's a $500-$1,500 TCPA violation per call if
    // the number actually IS listed. Now we fail closed.
    global.fetch = vi.fn().mockResolvedValue(
      new Response("upstream timeout", { status: 504 }),
    );
    const r = await checkDnc("415-555-2671");
    expect(r.flagged).toBe(true);
    expect(r.source).toBe("vendor-error");
    expect(r.reason).toMatch(/504/);
  });

  it("returns flagged=true with source=vendor-error on a 4xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    const r = await checkDnc("415-555-2671");
    expect(r.flagged).toBe(true);
    expect(r.source).toBe("vendor-error");
    expect(r.reason).toMatch(/401/);
  });

  it("returns flagged=true with source=vendor-error on a network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const r = await checkDnc("415-555-2671");
    expect(r.flagged).toBe(true);
    expect(r.source).toBe("vendor-error");
    expect(r.reason).toMatch(/ECONNRESET/i);
  });

  it("does NOT fall back to the local last-4 check when vendor is configured but failing", async () => {
    // The local fallback only matches CI fixture suffixes. Falling
    // back to it in live mode means a real DNC-listed number with a
    // normal last 4 would pass through as 'not flagged'.
    global.fetch = vi.fn().mockRejectedValue(new Error("vendor down"));
    const r = await checkDnc("415-555-2671");
    expect(r.source).toBe("vendor-error");
    expect(r.source).not.toBe("local-fallback");
    expect(r.flagged).toBe(true);
  });

  it("returns flagged=true when vendor says the number is listed", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ dnc: true, reason: "federal DNC" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const r = await checkDnc("415-555-2671");
    expect(r.flagged).toBe(true);
    expect(r.source).toBe("vendor");
    expect(r.reason).toMatch(/federal DNC/);
  });

  it("returns flagged=false when vendor says the number is clean", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ dnc: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const r = await checkDnc("415-555-2671");
    expect(r.flagged).toBe(false);
    expect(r.source).toBe("vendor");
  });
});
