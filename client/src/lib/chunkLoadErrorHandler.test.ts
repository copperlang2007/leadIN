import { describe, it, expect } from "vitest";
import { __test } from "./chunkLoadErrorHandler";

const { isChunkLoadError } = __test;

// installChunkLoadErrorHandler touches window/sessionStorage which
// the project's vitest config (node env, no jsdom) doesn't provide.
// The interesting decision — what counts as a chunk-load error worth
// reloading for — lives in isChunkLoadError and is fully covered
// here. Reload behaviour is exercised manually.

describe("isChunkLoadError", () => {
  it("matches Vite's dynamic import failure message", () => {
    expect(
      isChunkLoadError(
        "Failed to fetch dynamically imported module: https://leadmarket.app/assets/pricing-abc123.js",
      ),
    ).toBe(true);
  });

  it("matches the alternate Vite 'module script failed' message", () => {
    expect(
      isChunkLoadError(
        "Importing a module script failed: /assets/admin-OLDHASH.js",
      ),
    ).toBe(true);
  });

  it("matches webpack-style ChunkLoadError", () => {
    // Kept for safety — third-party libs (e.g. Next.js loadable
    // pulled in via a dependency) may emit this even though we're
    // on Vite.
    expect(isChunkLoadError("ChunkLoadError: Loading chunk 42 failed")).toBe(
      true,
    );
  });

  it("matches the 'Loading chunk N failed' phrase on its own", () => {
    expect(isChunkLoadError("Loading chunk pricing failed.")).toBe(true);
  });

  it("does NOT match generic JS errors", () => {
    expect(isChunkLoadError("Cannot read property 'foo' of undefined")).toBe(
      false,
    );
    expect(isChunkLoadError("Network request failed")).toBe(false);
    expect(isChunkLoadError("ReferenceError: x is not defined")).toBe(false);
  });

  it("does NOT match a chunk-shaped error that isn't a load failure", () => {
    // Regression guard: don't reload on a chunk validation error
    // from the bundler — that's not user-recoverable via reload.
    expect(isChunkLoadError("Invalid chunk signature")).toBe(false);
  });

  it("returns false for undefined / empty messages", () => {
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError("")).toBe(false);
  });

  it("is case-insensitive to handle browser variations", () => {
    expect(
      isChunkLoadError("failed to fetch dynamically imported module"),
    ).toBe(true);
  });
});
