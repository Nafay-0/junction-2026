import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/*
 * The one connection pool to Postgres. In development the server reloads its code on every edit;
 * the pool is kept on globalThis so a reload reuses it instead of opening another.
 */

type Store = { url?: string; sql?: postgres.Sql; db?: PostgresJsDatabase<typeof schema> };
const holder = globalThis as unknown as { __berylDb?: Store };
const store = (holder.__berylDb ??= {});

/** The database is not configured or cannot be reached. `message` is a sentence fit to show. */
export class DatabaseUnavailable extends Error {}

export const NO_DATABASE_URL = "No database is set up. Add DATABASE_URL to exa/.env.local (see .env.example) and restart.";

/** The database, opened on first use. Throws DatabaseUnavailable when DATABASE_URL is missing. */
export function database(): PostgresJsDatabase<typeof schema> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new DatabaseUnavailable(NO_DATABASE_URL);
  if (!store.db || store.url !== url) {
    void store.sql?.end({ timeout: 5 }).catch(() => {});
    store.sql = postgres(url, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
      // Connection poolers that hand each transaction a different connection cannot keep prepared statements.
      prepare: !/pooler|pgbouncer=true|:6543\b/i.test(url),
    });
    store.db = drizzle(store.sql, { schema });
    store.url = url;
  }
  return store.db;
}

export { schema };
