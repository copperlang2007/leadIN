// DATABASE_URL is read at module-load time by server/db.ts. Unit tests don't
// touch the DB but need this set so imports succeed.
process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.SESSION_SECRET ||= "test-secret";
process.env.REPL_ID ||= "test-repl-id";
