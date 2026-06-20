import { describe, it, expect } from "vitest";
import { buildCanonicalUrl } from "./useCanonicalUrl";

// The hook itself touches `document` which the project's vitest
// config (node environment, no jsdom dep) doesn't provide. The
// interesting decision — what URL do we emit — is in the pure
// buildCanonicalUrl function and is exhaustively covered here.

describe("buildCanonicalUrl", () => {
  it("uses the explicit path when provided", () => {
    expect(buildCanonicalUrl("/pricing", "https://leadmarket.app")).toBe(
      "https://leadmarket.app/pricing",
    );
  });

  it("defaults to /  when path is undefined", () => {
    expect(buildCanonicalUrl(undefined, "https://leadmarket.app")).toBe(
      "https://leadmarket.app/",
    );
  });

  it("strips utm + tracking query strings from the canonical", () => {
    // The whole point of canonical: collapse tracking variants.
    expect(
      buildCanonicalUrl(
        "/pricing?utm_source=twitter&fbclid=abc123",
        "https://leadmarket.app",
      ),
    ).toBe("https://leadmarket.app/pricing");
  });

  it("strips hash fragments from the canonical", () => {
    expect(
      buildCanonicalUrl("/pricing#tier-pro", "https://leadmarket.app"),
    ).toBe("https://leadmarket.app/pricing");
  });

  it("strips both query and hash", () => {
    expect(
      buildCanonicalUrl(
        "/blog/some-post?utm=x#section-2",
        "https://leadmarket.app",
      ),
    ).toBe("https://leadmarket.app/blog/some-post");
  });

  it("prepends a leading slash when the path is missing one", () => {
    expect(buildCanonicalUrl("pricing", "https://leadmarket.app")).toBe(
      "https://leadmarket.app/pricing",
    );
  });

  it("collapses duplicate slashes in the path", () => {
    expect(
      buildCanonicalUrl("//blog///some-post", "https://leadmarket.app"),
    ).toBe("https://leadmarket.app/blog/some-post");
  });

  it("strips trailing slashes from the origin", () => {
    expect(buildCanonicalUrl("/pricing", "https://leadmarket.app/")).toBe(
      "https://leadmarket.app/pricing",
    );
    expect(buildCanonicalUrl("/pricing", "https://leadmarket.app//")).toBe(
      "https://leadmarket.app/pricing",
    );
  });

  it("handles a path that's only a query string as /", () => {
    expect(buildCanonicalUrl("?utm_source=email", "https://leadmarket.app")).toBe(
      "https://leadmarket.app/",
    );
  });
});
