import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isComplianceServiceEnabled,
  getComplianceServiceStatus,
  verifyCertificate,
  pingComplianceService,
} from "./complianceService";

// These tests cover the flag-gated "disabled" path — the invariant that the
// client is completely inert (and never throws or hits the network) until both
// env vars are configured. The enabled network path is exercised end-to-end
// once MCF is deployed.
describe("complianceService (disabled / unconfigured)", () => {
  const prevUrl = process.env.MCF_URL;
  const prevSecret = process.env.MCF_SERVICE_SECRET;

  beforeEach(() => {
    delete process.env.MCF_URL;
    delete process.env.MCF_SERVICE_SECRET;
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.MCF_URL;
    else process.env.MCF_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.MCF_SERVICE_SECRET;
    else process.env.MCF_SERVICE_SECRET = prevSecret;
  });

  it("is disabled when neither var is set", () => {
    expect(isComplianceServiceEnabled()).toBe(false);
    expect(getComplianceServiceStatus()).toEqual({
      enabled: false,
      urlConfigured: false,
      secretConfigured: false,
    });
  });

  it("stays disabled when only the URL is set", () => {
    process.env.MCF_URL = "https://mcf.example.com";
    expect(isComplianceServiceEnabled()).toBe(false);
    expect(getComplianceServiceStatus()).toEqual({
      enabled: false,
      urlConfigured: true,
      secretConfigured: false,
    });
  });

  it("verifyCertificate resolves null without a network call when disabled", async () => {
    await expect(verifyCertificate({ any: "cert" })).resolves.toBeNull();
  });

  it("pingComplianceService resolves false when disabled", async () => {
    await expect(pingComplianceService()).resolves.toBe(false);
  });
});
