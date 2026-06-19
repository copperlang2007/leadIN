// Skip-to-main-content link.
//
// WCAG 2.4.1 (Bypass Blocks): every page that repeats header/nav
// elements at the top must offer a way to jump past them to the
// primary content. Without this a keyboard / screen-reader user has
// to tab through the entire sidebar + header on every page load —
// brutally slow.
//
// Behaviour:
//   - Visually hidden by default (`-translate-y-16` parks it
//     offscreen). Tailwind's `transition-transform` animates the
//     transform property, so the slide-in actually fires on focus.
//   - On focus (Tab from URL bar), translates back into view at the
//     top-left so a sighted keyboard user sees where they are.
//   - Activates the in-page anchor #main-content. We handle the
//     click ourselves and call .focus() on the target — relying on
//     fragment-href + tabIndex={-1} alone is spotty across browsers
//     (Safari in particular has historically not moved keyboard
//     focus on fragment-only navigation).

import { useCallback } from "react";

export function SkipLink() {
  const onActivate = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const target = document.getElementById("main-content");
    if (!target) return;
    // Move keyboard focus explicitly. tabIndex={-1} on the target
    // makes the focus() call valid for non-form elements.
    target.focus();
    // Update the URL hash for parity with the native fragment behaviour
    // (some users / scripts rely on the hash as a route signal).
    if (typeof history !== "undefined" && history.replaceState) {
      history.replaceState(null, "", "#main-content");
    } else {
      window.location.hash = "main-content";
    }
  }, []);

  return (
    <a
      href="#main-content"
      onClick={onActivate}
      className="
        absolute left-2 top-2 z-50 rounded-md bg-primary px-3 py-2
        text-sm font-semibold text-primary-foreground shadow-lg
        -translate-y-16 transition-transform
        focus:translate-y-0
        focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
      "
      data-testid="skip-to-main"
    >
      Skip to main content
    </a>
  );
}
