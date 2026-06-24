import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTracker } from "./lib/tracker";
import { bootGa } from "./lib/ga";
import { installChunkLoadErrorHandler } from "./lib/chunkLoadErrorHandler";

// Monkey-patch fetch so every same-origin write request automatically carries
// the CSRF token. Cleaner than touching dozens of call sites.
(() => {
  const origFetch = window.fetch;
  function getCsrfToken(): string | undefined {
    const m = document.cookie.match(/(?:^|;\s*)lm_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : undefined;
  }
  window.fetch = function (input: RequestInfo | URL, init: RequestInit = {}) {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init.method ?? "GET").toUpperCase();
      const isWrite = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
      const isSameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
      if (isWrite && isSameOrigin) {
        const token = getCsrfToken();
        if (token) {
          const headers = new Headers(init.headers ?? {});
          if (!headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", token);
          init = { ...init, headers };
        }
      }
    } catch {}
    return origFetch(input, init);
  };
})();

// installChunkLoadErrorHandler MUST run before any lazy() import can
// resolve so a stale-deploy reject lands here, not in ErrorBoundary.
installChunkLoadErrorHandler();
bootGa();
installTracker();

// StrictMode runs effects + state updaters TWICE in dev (no-op in prod
// bundles via the React fast-refresh + production builds). The double-
// invocation surfaces effect-cleanup bugs early — a hook that creates
// a side effect on mount but doesn't tear it down would have stacked
// effects in dev, where in prod the bug would only manifest at
// suspicious moments (e.g., the user navigating away and back to a
// route fast enough to race the unmount). The recent useCanonicalUrl
// + useNoindex hooks (#96 and #99) both use createdHere flags
// specifically to be StrictMode-safe; this turns that contract on.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
