import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
