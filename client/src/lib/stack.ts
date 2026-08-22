// Neon Auth (Stack Auth) client app — the SPA side of the identity
// handshake. The SDK owns the sign-in UI and token lifecycle; after a
// successful sign-in the /auth page exchanges the access token for a
// first-party server session (POST /api/auth/session), and every API call
// keeps using the same session cookie it always has.
//
// Null when Neon Auth isn't configured (dev/CI without keys) — the /auth
// page renders a configuration notice instead of crashing the bundle.
import { StackClientApp } from "@stackframe/react";

const projectId = import.meta.env.VITE_STACK_PROJECT_ID;
const publishableClientKey = import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY;

export const stackClientApp =
  projectId && publishableClientKey
    ? new StackClientApp({
        projectId,
        publishableClientKey,
        tokenStore: "cookie",
        redirectMethod: "window",
      })
    : null;
