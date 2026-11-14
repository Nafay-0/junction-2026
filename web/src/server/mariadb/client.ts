import * as mariadb from "mariadb";
import { parseMariaUrl, type MariaConfig } from "./config";

/**
 * A small pool on the official MariaDB connector. Every connection works in UTC, so `FOR SYSTEM_TIME AS OF
 * '2026-10-20 07:30:00'` names the same moment on a laptop, in a container and on a hosted server.
 * Times travel as strings ('YYYY-MM-DD HH:MM:SS.ffffff', UTC) both ways: no Date conversion in the driver.
 */
export type Maria = {
  config: MariaConfig;
  pool: mariadb.Pool;
  /** One statement, timed. `sql` is the text with ? placeholders, kept so a page can show exactly what ran. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Timed<T>>;
  close(): Promise<void>;
};

export type Timed<T> = { rows: T[]; ms: number; sql: string; params: unknown[] };

export function connectMaria(url: string, opts: { connections?: number; timeoutMs?: number } = {}): Maria {
  const config = parseMariaUrl(url);
  const pool = mariadb.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    connectionLimit: opts.connections ?? 3,
    connectTimeout: opts.timeoutMs ?? 4000,
    acquireTimeout: (opts.timeoutMs ?? 4000) + 1000,
    dateStrings: true,
    bigIntAsNumber: true,
    decimalAsNumber: true,
    insertIdAsNumber: true,
    checkDuplicate: false,
    initSql: ["SET time_zone = '+00:00'"],
  });
  return {
    config,
    pool,
    async query<T>(sql: string, params: unknown[] = []) {
      const t0 = performance.now();
      const res = (await pool.query({ sql, namedPlaceholders: false }, params)) as unknown;
      const ms = performance.now() - t0;
      const rows = Array.isArray(res) ? (res as T[]).filter((r) => r !== null && typeof r === "object" && !Array.isArray(r)) : [];
      return { rows: rows.map((r) => ({ ...(r as object) }) as T), ms, sql, params };
    },
    close: () => pool.end(),
  };
}

/** ISO instant to MariaDB's TIMESTAMP(6) text, in UTC. */
export function sqlTime(at: string | Date | number): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) throw new Error(`not a time: ${String(at)}`);
  return d.toISOString().replace("T", " ").replace("Z", "").padEnd(26, "0");
}

/** MariaDB's TIMESTAMP(6) text (UTC) back to ISO. The open end of a current row (2106-02-07 …, or 2038 on old servers) reads as undefined. */
export function isoTime(s: unknown): string | undefined {
  if (s === null || s === undefined) return undefined;
  const text = String(s);
  if (text.startsWith("2106-") || text.startsWith("2038-01-19")) return undefined;
  const d = new Date(text.replace(" ", "T") + (text.endsWith("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** A JSON column or JSON_OBJECT(...) as an object, whether the driver parsed it or handed over text. */
export function json<T = unknown>(v: unknown): T {
  if (typeof v === "string") return JSON.parse(v) as T;
  return v as T;
}
