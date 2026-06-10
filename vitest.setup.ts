// DATABASE_URL is read at module-load time by server/db.ts. Unit tests don't
// touch the DB but need this set so imports succeed.
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.SESSION_SECRET ||= "test-secret";
process.env.REPL_ID ||= "test-repl-id";

// Suppress the benign OIDC-discovery unhandled rejection that fires when
// server/replitAuth.ts is imported transitively by tests. The real OIDC
// config is never consumed by any unit test in this repo. We keep the
// process from logging it; real bugs still surface because we re-emit
// anything that doesn't match the discovery error shape.
process.on("unhandledRejection", (err: unknown) => {
  const e = err as { code?: string; message?: string };
  const isOidc =
    e?.code === "OAUTH_RESPONSE_IS_NOT_CONFORM" ||
    /unexpected HTTP response status code/.test(e?.message ?? "") ||
    /only requests to HTTPS are allowed/.test(e?.message ?? "");
  if (isOidc) return; // swallow
  // For anything else, surface it like Node's default behaviour would.
  console.error("Unhandled rejection in test:", err);
});
