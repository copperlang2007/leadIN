/// <reference types="vite/client" />

// Typed declarations for VITE_* env vars baked into the client bundle
// at build time. Centralising these means:
//
//   1. Every consumer of `import.meta.env.VITE_X` gets the right type
//      without re-asserting the shape inline.
//   2. Adding a new VITE_* var lands here first as a single source of
//      truth, and the rest of the codebase picks up the type via the
//      ambient module augmentation.
//   3. A typo at a call site (`VITE_GA_MEASUREMENTID`) now fails the
//      compile instead of silently resolving to undefined at runtime.
//
// Keep entries in sync with .env.example. Both are optional because
// the runtime fallbacks in each consumer (ga.ts, useCanonicalUrl.ts)
// already handle absence — making them required here would make
// dev builds fail just from a missing env file.

interface ImportMetaEnv {
  /** Google Analytics 4 measurement ID. When present and shaped like
   *  G-XXXXXXXX, client/src/lib/ga.ts boots GA on first paint.
   *  Leave unset in dev/CI to avoid emitting beacons to a non-existent
   *  property. */
  readonly VITE_GA_MEASUREMENT_ID?: string;

  /** Canonical origin used by client/src/hooks/useCanonicalUrl.ts to
   *  build absolute <link rel="canonical"> hrefs. Defaults to
   *  https://leadmarket.app when unset. Override only if the
   *  production domain changes. */
  readonly VITE_CANONICAL_ORIGIN?: string;

  /** Neon Auth (Stack) project id — required for sign-in. When unset,
   *  the /auth page renders a configuration notice instead of the
   *  sign-in UI (dev/CI-safe). Also read server-side for JWKS. */
  readonly VITE_STACK_PROJECT_ID?: string;

  /** Neon Auth publishable client key, paired with the project id. */
  readonly VITE_STACK_PUBLISHABLE_CLIENT_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
