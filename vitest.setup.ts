// DATABASE_URL is read at module-load time by server/db.ts. Unit tests don't
// touch the DB but need this set so imports succeed.
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.SESSION_SECRET ||= "test-secret";

// Surface unhandled rejections like Node's default behaviour would —
// nothing in the auth layer performs network discovery at import time
// anymore (Neon Auth JWKS is fetched lazily on first verification).
process.on("unhandledRejection", (err: unknown) => {
  console.error("Unhandled rejection in test:", err);
});
