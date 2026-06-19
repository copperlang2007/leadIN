// Skip-to-main-content link.
//
// WCAG 2.4.1 (Bypass Blocks): every page that repeats header/nav
// elements at the top must offer a way to jump past them to the
// primary content. Without this a keyboard / screen-reader user has
// to tab through the entire sidebar + header on every page load —
// brutally slow.
//
// Behaviour:
//   - Visually hidden by default (positioned offscreen via Tailwind's
//     sr-only utility classes — `absolute -top-10` is what becomes
//     visible on focus).
//   - On focus (Tab from URL bar), translates back into view at the
//     top-left so a sighted keyboard user sees where they are.
//   - Activates the in-page anchor #main-content, which is wired to
//     the wrapper around the Router in App.tsx.

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="
        absolute left-2 -top-10 z-50 rounded-md bg-primary px-3 py-2
        text-sm font-semibold text-primary-foreground shadow-lg
        transition-transform
        focus:top-2 focus:translate-y-0
        focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
      "
      data-testid="skip-to-main"
    >
      Skip to main content
    </a>
  );
}
