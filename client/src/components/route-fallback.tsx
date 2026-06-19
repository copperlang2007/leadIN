// Page-level Suspense fallback used while a lazy-loaded route's
// JS chunk is downloading.
//
// Centered spinner over a full-height background. Matches the
// app's design system (primary spinner colour, muted background)
// so the transition between "loading chunk" and "page rendered"
// doesn't flash a foreign-looking screen.
//
// Goes on for a fraction of a second on first navigation to a
// route the user hasn't visited yet, then never again (the chunk
// is cached by the browser + Vite's manifest).

import { Loader2 } from "lucide-react";

export function RouteFallback() {
  return (
    <div
      className="min-h-[60vh] flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
