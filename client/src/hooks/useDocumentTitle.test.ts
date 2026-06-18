import { describe, it, expect } from "vitest";
import { buildTitle, APP_NAME } from "./useDocumentTitle";

describe("buildTitle", () => {
  it("appends the brand suffix when given a string", () => {
    expect(buildTitle("Pricing")).toBe(`Pricing · ${APP_NAME}`);
  });

  it("appends the brand suffix when given { part } without full", () => {
    expect(buildTitle({ part: "Marketplace" })).toBe(`Marketplace · ${APP_NAME}`);
  });

  it("uses the part verbatim when full=true", () => {
    expect(buildTitle({ part: "Custom title with brand inside", full: true })).toBe(
      "Custom title with brand inside",
    );
  });

  it("treats an empty part as just the suffix (not an empty title)", () => {
    // Edge case: a page that wants only the brand. We don't promise a
    // specific shape here — only that it stays non-empty and contains
    // the brand, so favicons/tab-strip don't go blank.
    const out = buildTitle("");
    expect(out).toContain(APP_NAME);
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not duplicate the brand when full=true and part already includes it", () => {
    const out = buildTitle({ part: `Welcome to ${APP_NAME}`, full: true });
    expect(out).toBe(`Welcome to ${APP_NAME}`);
    expect(out.match(new RegExp(APP_NAME, "g"))?.length).toBe(1);
  });
});
