import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyLicense, stubVerify, isNiprLive } from "./nipr.js";

describe("nipr stub backend", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.NIPR_API_KEY;
    delete process.env.NIPR_API_KEY;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.NIPR_API_KEY = savedKey;
  });

  it("returns verified=true for >=6-char license numbers in stub mode", async () => {
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    expect(res.verified).toBe(true);
    expect(res.classes).toContain("Life");
    expect(res.classes).toContain("Health");
    expect(res.expiresAt).toBeInstanceOf(Date);
    expect(isNiprLive()).toBe(false);
  });

  it("returns verified=false for short license numbers", () => {
    const res = stubVerify({ state: "FL", licenseNumber: "abc" });
    expect(res.verified).toBe(false);
    expect(res.error).toBeDefined();
  });
});

describe("nipr live backend fails closed", () => {
  let savedKey: string | undefined;
  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    savedKey = process.env.NIPR_API_KEY;
    process.env.NIPR_API_KEY = "test-key-not-real";
    savedFetch = global.fetch;
  });
  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.NIPR_API_KEY = savedKey;
    } else {
      delete process.env.NIPR_API_KEY;
    }
    global.fetch = savedFetch;
  });

  it("does NOT fall back to the stub when the live call rejects (network error)", async () => {
    // Regression: an NIPR outage used to flip silently to stub mode,
    // which auto-verifies any 6+ char license. That defeats the whole
    // point of running in live mode — an attacker could pick a moment
    // when NIPR is rate-limiting us and submit a fabricated license.
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/ECONNRESET|nipr verify failed/i);
    // Stub would have returned classes; live failure must not.
    expect(res.classes).toBeUndefined();
  });

  it("does NOT fall back to the stub on a 5xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("upstream timeout", { status: 504 }),
    );
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/NIPR HTTP 504/);
    expect(res.classes).toBeUndefined();
  });

  it("does NOT fall back to the stub on a 4xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/NIPR HTTP 404/);
  });

  it("returns verified=true when NIPR reports the license as active", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          licenses: [
            {
              status: "active",
              expirationDate: "2027-12-31",
              lineOfAuthority: ["Life", "Health", "Variable"],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    expect(res.verified).toBe(true);
    expect(res.classes).toEqual(["Life", "Health", "Variable"]);
    expect(res.expiresAt).toBeInstanceOf(Date);
  });

  it("returns verified=false when NIPR reports the license as inactive", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ license: { status: "inactive" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    expect(res.verified).toBe(false);
  });

  it("treats empty NIPR_API_KEY as misconfig — calls live API, doesn't drop into stub", async () => {
    // An env var present-but-empty means "live mode intended, but the
    // secret didn't resolve". We must NOT silently treat that as
    // stub mode, because the stub auto-verifies. NIPR will 401 on
    // an empty Bearer token; that's exactly the fail-closed shape
    // we want.
    process.env.NIPR_API_KEY = "";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    global.fetch = fetchMock;
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    expect(fetchMock).toHaveBeenCalled();
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/NIPR HTTP 401/);
  });
});

describe("nipr timeout override", () => {
  let savedKey: string | undefined;
  let savedTimeout: string | undefined;
  let savedFetch: typeof global.fetch;

  beforeEach(() => {
    savedKey = process.env.NIPR_API_KEY;
    savedTimeout = process.env.NIPR_TIMEOUT_MS;
    process.env.NIPR_API_KEY = "test-key";
    savedFetch = global.fetch;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.NIPR_API_KEY = savedKey;
    else delete process.env.NIPR_API_KEY;
    if (savedTimeout !== undefined) process.env.NIPR_TIMEOUT_MS = savedTimeout;
    else delete process.env.NIPR_TIMEOUT_MS;
    global.fetch = savedFetch;
  });

  it("honours a custom NIPR_TIMEOUT_MS by aborting the call quickly", async () => {
    process.env.NIPR_TIMEOUT_MS = "10";
    // Stub fetch with a never-resolving promise that only rejects on
    // abort. Without the env override (default 10s) this test would
    // timeout; with 10ms it aborts fast and returns the fail-closed
    // result.
    global.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const start = Date.now();
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    const elapsed = Date.now() - start;
    expect(res.verified).toBe(false);
    expect(elapsed).toBeLessThan(1000);
  });

  it("ignores a non-numeric NIPR_TIMEOUT_MS and uses the default", async () => {
    process.env.NIPR_TIMEOUT_MS = "not-a-number";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ license: { status: "active" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await verifyLicense({ state: "FL", licenseNumber: "A123456" });
    // The call succeeds — i.e. the bad timeout didn't crash the
    // module and the default (10s) was used instead.
    expect(res.verified).toBe(true);
  });
});
