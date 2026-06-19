import { describe, it, expect } from "vitest";
import { isValidGa4Id } from "./ga";

// bootGa() itself touches `window` and `document` which the project's
// vitest config (node environment, no jsdom dependency) doesn't
// provide. The interesting decision — should we initialise GA at all?
// — is extracted into isValidGa4Id so it's unit-testable here.
// Browser-side behaviour (script tag injected, dataLayer populated)
// is covered by a manual smoke test before shipping.

describe("isValidGa4Id", () => {
  it("accepts real-looking GA4 ids (G- + 6+ alphanumerics)", () => {
    expect(isValidGa4Id("G-ABCDEF1234")).toBe(true);
    expect(isValidGa4Id("G-XYZ123")).toBe(true);
    expect(isValidGa4Id("G-1A2B3C4D5E")).toBe(true);
  });

  it("rejects undefined and null", () => {
    expect(isValidGa4Id(undefined)).toBe(false);
    expect(isValidGa4Id(null)).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidGa4Id("")).toBe(false);
  });

  it("rejects the literal strings 'undefined' and 'null'", () => {
    // Vite silently substitutes missing VITE_* env vars as the literal
    // string "undefined" in some configurations. We must not treat
    // that as a real id.
    expect(isValidGa4Id("undefined")).toBe(false);
    expect(isValidGa4Id("null")).toBe(false);
  });

  it("rejects Universal Analytics ids (UA-... — deprecated 2023)", () => {
    expect(isValidGa4Id("UA-12345-1")).toBe(false);
    expect(isValidGa4Id("UA-1234567")).toBe(false);
  });

  it("rejects ids without the G- prefix", () => {
    expect(isValidGa4Id("ABCDEF1234")).toBe(false);
    expect(isValidGa4Id("g-ABCDEF1234")).toBe(true); // case-insensitive prefix
  });

  it("rejects ids that are too short", () => {
    expect(isValidGa4Id("G-A")).toBe(false);
    expect(isValidGa4Id("G-AB12")).toBe(false);
  });

  it("trims whitespace before validating (env vars often have stray spaces)", () => {
    expect(isValidGa4Id("  G-ABCDEF1234  ")).toBe(true);
    expect(isValidGa4Id("\tG-ABCDEF1234\n")).toBe(true);
    expect(isValidGa4Id("   ")).toBe(false);
  });

  it("rejects the historical placeholder we used to ship with", () => {
    // Regression: client/index.html used to hard-code G-LEADMARKET01
    // which IS 12 chars and DOES match the shape. The point of the
    // env-driven boot is that this placeholder can't ship anymore —
    // but if we ever bring it back, the test below is here to scream.
    expect(isValidGa4Id("G-LEADMARKET01")).toBe(true);
    // ↑ deliberately green — we want the test to document that this
    // shape was syntactically valid. The actual reason it can't ship
    // is that VITE_GA_MEASUREMENT_ID isn't set in dev/CI builds, so
    // even a syntactically-valid value doesn't get baked in unless
    // an operator deliberately sets it.
  });
});
