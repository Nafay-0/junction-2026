import { Pool, type PoolClient, type QueryConfig } from "pg";
import { errMessage, log, pgConnectionString, pgPoolMax } from "../env";
import { asStoreError, isStoreConnectionError } from "./errors";
import { TELEMETRY_SQL, schemaSql } from "./schema";

/**
 * One small pool per process. The free plan allows 20 connections in total, shared with Grafana (3), the Aiven
 * console and MCP, laptops and a second app instance, so the app holds at most DOCK_PG_POOL_MAX (default 4),
 * closes idle ones after 30 s, and every statement is short (5 s statement timeout; transactions are a few
 * statements). The pool never keeps a script alive on its own (allowExitOnIdle).
 *
 * Every wait is bounded on this side too, because a server-side statement_timeout never fires when the network
 * between us and the database drops packets (a partition): nothing would ever answer.
 *   DOCK_PG_CONNECT_TIMEOUT_MS  getting a connection, whether opening one (TCP + TLS) or waiting in the pool's
 *                               queue for a free one (default 5000)
 *   DOCK_PG_QUERY_TIMEOUT_MS    one statement, client side (default 6000: the 5 s server timeout plus the trip)
 * A connection-class failure (refused, reset, timed out, cut) becomes a 503 `store_unavailable` DockError
 * (errors.ts), which every route already turns into JSON; and a connection that timed out is thrown away, never
 * handed to the next request.
 */
const ms = (name: string, fallback: number) => {
  const n = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
export const pgConnectTimeoutMs = () => ms("DOCK_PG_CONNECT_TIMEOUT_MS", 5_000);
export const pgQueryTimeoutMs = () => ms("DOCK_PG_QUERY_TIMEOUT_MS", 6_000);

export function createPool(connectionString = pgConnectionString(), max = pgPoolMax()): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: pgConnectTimeoutMs(),
    query_timeout: pgQueryTimeoutMs(),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    allowExitOnIdle: true,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: "dock-app",
  });
  // An idle client that loses its connection must not crash the process.
  pool.on("error", (err) => log("warn", "postgres idle client error", { error: errMessage(err) }));
  return withStoreErrors(pool);
}

/**
 * Wrap the pool's promise API so connection-class failures surface as `store_unavailable`. pool.query already
 * discards the client on any error; connect() hands out clients whose own query errors are converted too.
 */
export function withStoreErrors(pool: Pool): Pool {
  const query = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  const connect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  const failed = (err: unknown) => {
    if (isStoreConnectionError(err)) log("warn", "postgres unavailable", { error: errMessage(err) });
    throw asStoreError(err);
  };
  (pool as { query: unknown }).query = (...args: unknown[]) => {
    const r = query(...args);
    return r && typeof (r as Promise<unknown>).then === "function" ? (r as Promise<unknown>).catch(failed) : r;
  };
  (pool as { connect: unknown }).connect = (...args: unknown[]) => {
    if (typeof args[0] === "function") return connect(...args); // callback form: left as it is
    return (connect() as Promise<PoolClient>).catch(failed);
  };
  return pool;
}

export async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  let broken: unknown;
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (err) {
    // A connection that timed out or broke may still have a statement in flight: never reuse it.
    if (isStoreConnectionError(err)) broken = err;
    else await c.query("rollback").catch((e) => (broken = isStoreConnectionError(e) ? e : undefined));
    throw asStoreError(err);
  } finally {
    c.release(broken instanceof Error ? broken : broken ? new Error("connection broken") : undefined);
  }
}

/**
 * Create or update Dock's tables. Safe to run on every start and from several processes at once: an advisory
 * lock serialises concurrent runs, and every statement is idempotent.
 */
export async function migrate(pool: Pool, schema: string, opts: { telemetry?: boolean } = {}): Promise<void> {
  // The migration is the one long statement: it gets 30 s on the server and 35 s on this side (pg reads
  // query_timeout per query; @types/pg does not list it).
  const long = (text: string) => ({ text, query_timeout: 35_000 }) as QueryConfig;
  await inTransaction(pool, async (c) => {
    await c.query("set local statement_timeout = '30s'");
    await c.query(long("select pg_advisory_xact_lock(hashtext('dock-migrate'))"));
    await c.query(long("create extension if not exists pgcrypto with schema public"));
    if (opts.telemetry) await c.query(long(TELEMETRY_SQL));
    await c.query(long(schemaSql(schema)));
  });
}
