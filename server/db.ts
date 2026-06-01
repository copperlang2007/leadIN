import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Close the PG pool during graceful shutdown. Resolves even if the underlying
// pool throws — we never want a stuck pool to block process exit.
export async function closePool(): Promise<void> {
  try {
    await pool.end();
  } catch {
    // ignore — best-effort during shutdown
  }
}
