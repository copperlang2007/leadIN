import { describe, it, expect } from "vitest";
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
