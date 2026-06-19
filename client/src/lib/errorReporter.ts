// Forward a caught React render error to the server.
//
// Without this, errors caught by ErrorBoundary die in the user's
// browser console. POSTing a small structured envelope to
// /api/errors lets the server pipe them into Sentry (where the rest
// of the server's errors already land) so we can triage prod issues
// the same way regardless of which side of the wire they happened on.
//
// Best-effort: failures here are silent. We don't want a broken
// reporter to surface ANOTHER error to the user.

export interface ClientErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  url?: string;
}

export function reportClientError(report: ClientErrorReport): void {
  // SSR / test guard. The SPA never renders server-side today, but
  // referencing window / fetch unconditionally would crash a future
  // Node-side import-for-side-effects.
  if (typeof window === "undefined" || typeof fetch === "undefined") {
    return;
  }
  // Resolve the URL once so the JSON.stringify below stays pure.
  const url = report.url ?? window.location.href;
  // Don't block render — fire-and-forget.
  try {
    void fetch("/api/errors", {
      method: "POST",
      // Same-origin only — no need for CORS preflights, and the CSRF
      // monkey-patch in main.tsx will attach the token automatically.
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      // keepalive lets the request complete even if the page is
      // unloading (e.g. the user closed the tab after the error).
      keepalive: true,
      body: JSON.stringify({
        message: report.message,
        stack: report.stack,
        componentStack: report.componentStack,
        url,
      }),
    }).catch(() => {
      // Network failure — nothing useful to do. Don't surface.
    });
  } catch {
    // JSON.stringify or fetch itself throwing synchronously — also
    // swallowed. The user has already seen the error UI; another
    // alert wouldn't help.
  }
}
