import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/*
 * Applies the SQL files in drizzle/ that the database has not seen yet. Used by the server when it
 * starts and by `pnpm db:migrate` (scripts/db-migrate.mjs), which is why this file imports nothing
 * from the app: plain Node can load it.
 */

/** Any number, as long as every instance uses the same one: it is the name of the lock. */
const LOCK = 7_203_114_951;

/**
 * Bring the database up to date. Safe when several server instances start together: the first
 * takes a lock, the others wait for it and then find nothing left to do.
 */
export async function runMigrations(url: string, folder = path.join(process.cwd(), "drizzle")): Promise<void> {
  // One connection, so the lock and the migration share a session.
  const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${LOCK})`;
    try {
      await migrate(drizzle(sql), { migrationsFolder: folder });
    } finally {
      await sql`select pg_advisory_unlock(${LOCK})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
