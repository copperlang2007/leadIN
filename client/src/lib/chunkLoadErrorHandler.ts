// Stale-deploy chunk-reload guard.
//
// After PR #89 introduced React.lazy() for all non-critical routes,
// each navigation triggers a dynamic import of the route's chunk.
// That works perfectly during a session — until we deploy. The
// browser cached the OLD index.html (or just has it open in a tab),
// and the OLD index.html references chunk filenames that no longer
// exist on the server. The next click on a sidebar link triggers
// `import("/assets/pricing-OLDHASH.js")` which 404s, the lazy()
// promise rejects, and ErrorBoundary swallows it into the "Something
// went wrong" screen.
//
// User-visible result: the app appears broken until they manually
// hard-reload — which most won't think to do.
//
// This module catches the chunk-load rejection at the window level
// and reloads the page. A reload pulls the new index.html with the
// new chunk hashes, and the user lands back where they were.
//
// Detection is by error message shape, which is what Vite + Rollup
// emit when a dynamic import fails to fetch. We intentionally narrow
// to chunk-load errors — generic JS errors should still surface to
// ErrorBoundary + the /api/errors reporter, not silently reload.
//
// Guard against reload loops: a session-storage flag means a second
// failure within the same session falls through to the normal error
// path instead of bouncing forever.

const RELOAD_FLAG = "lcp_chunk_reload";

function isChunkLoadError(message: string | undefined): boolean {
  if (!message) return false;
  // Patterns produced by:
  //   - Vite's dynamic import in the browser ("Failed to fetch
  //     dynamically imported module" / "Importing a module script
  //     failed")
  //   - Webpack-style "ChunkLoadError" (kept for safety, even
  //     though we're on Vite — third-party libs may emit it)
  //   - "Loading chunk N failed"
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \w+ failed/i.test(
    message,
  );
}

function attemptReload(): void {
  try {
    if (window.sessionStorage.getItem(RELOAD_FLAG)) {
      // Already reloaded once this session — don't loop. Fall
      // through to ErrorBoundary so the user sees a real error
      // they can report instead of an endless refresh.
      return;
    }
    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // sessionStorage can throw on private-mode Safari or with
    // disk-full conditions. Skip the loop guard rather than crash.
  }
  window.location.reload();
}

export function installChunkLoadErrorHandler(): void {
  if (typeof window === "undefined") return;

  // Unhandled promise rejection — covers the React.lazy(() => import())
  // rejection path.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : undefined;
    if (isChunkLoadError(message)) {
      attemptReload();
    }
  });

  // Synchronous error — covers a script tag that fails to load
  // (e.g., a vendor chunk referenced via <script type="module"> in
  // the prod build).
  window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.message)) {
      attemptReload();
    }
  });
}

// Exported for unit tests — the actual install function is fire-and-
// forget so the test surface is the pure predicate.
export const __test = { isChunkLoadError, RELOAD_FLAG };
