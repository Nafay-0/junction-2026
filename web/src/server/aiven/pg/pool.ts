import { Pool, type PoolClient } from "pg";
import { errMessage, log, pgConnectionString, pgPoolMax } from "../env";
import { TELEMETRY_SQL, schemaSql } from "./schema";

/**
 * One small pool per process. The free plan allows 20 connections in total, shared with Grafana (3), the Aiven
 * console and MCP, laptops and a second app instance, so the app holds at most DOCK_PG_POOL_MAX (default 4),
 * closes idle ones after 30 s, and every statement is short (5 s statement timeout; transactions are a few
 * statements). The pool never keeps a script alive on its own (allowExitOnIdle).
 */
export function createPool(connectionString = pgConnectionString(), max = pgPoolMax()): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: "dock-app",
  });
  // An idle client that loses its connection must not crash the process.
  pool.on("error", (err) => log("warn", "postgres idle client error", { error: errMessage(err) }));
  return pool;
}

export async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (err) {
    await c.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Create or update Dock's tables. Safe to run on every start and from several processes at once: an advisory
 * lock serialises concurrent runs, and every statement is idempotent.
 */
export async function migrate(pool: Pool, schema: string, opts: { telemetry?: boolean } = {}): Promise<void> {
  await inTransaction(pool, async (c) => {
    await c.query("set local statement_timeout = '30s'");
    await c.query("select pg_advisory_xact_lock(hashtext('dock-migrate'))");
    await c.query("create extension if not exists pgcrypto with schema public");
    if (opts.telemetry) await c.query(TELEMETRY_SQL);
    await c.query(schemaSql(schema));
  });
}
