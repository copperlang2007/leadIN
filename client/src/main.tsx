import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTracker } from "./lib/tracker";
import { bootGa } from "./lib/ga";

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

bootGa();
installTracker();

createRoot(document.getElementById("root")!).render(<App />);
