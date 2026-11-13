import { Pool, types } from "pg";
import { errMessage, log } from "../env";
import { showcaseConfig } from "./config";
import { redact } from "./redact";
import { DEFAULT_TIMEOUT_MS, guardSql, type GuardResult } from "./sql-guard";

/**
 * The copilot's direct path to dock-pg: the read-only service user dock_copilot (DOCK_COPILOT_PG_URL), one small
 * pool, every query guarded (sql-guard.ts) and run in a READ ONLY transaction with a statement timeout, then
 * rolled back. Rows are capped and long values cut; the result is redacted before it leaves this file.
 */
export type QueryResult = {
  ok: true;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  /** More rows existed than the cap; only the first `maxRows` are here. */
  truncated: boolean;
  ms: number;
  path: "direct";
  as: string;
};
export type QueryFailure = { ok: false; sql: string; code: string; reason: string; path: "direct" };

const g = globalThis as typeof globalThis & { __dockCopilotPool?: Pool };

function pool(): Pool | undefined {
  const url = showcaseConfig().copilotPgUrl;
  if (!url) return undefined;
  if (!g.__dockCopilotPool) {
    const u = new URL(url);
    if (!u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");
    g.__dockCopilotPool = new Pool({
      connectionString: u.toString(),
      max: 1, // the role is limited to 2 connections; leave one for a laptop check
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 6_000,
      allowExitOnIdle: true,
      statement_timeout: DEFAULT_TIMEOUT_MS,
      query_timeout: DEFAULT_TIMEOUT_MS + 1_500,
      application_name: "dock-copilot",
      // counts (int8) and sums (numeric) as numbers, so the cards and the answer arithmetic agree
      types: { getTypeParser: (oid: number, format?: "text" | "binary") => (oid === 20 || oid === 1700 ? (v: string) => (v === null ? null : Number(v)) : types.getTypeParser(oid, format as "text")) },
    });
    g.__dockCopilotPool.on("error", (err) => log("warn", "copilot pool idle client error", { error: errMessage(err) }));
  }
  return g.__dockCopilotPool;
}

export function readOnlyDbConfigured(): boolean {
  return Boolean(showcaseConfig().copilotPgUrl);
}

/** Who the direct path connects as, for the answer card ("read as dock_copilot"). */
export function readOnlyUser(): string {
  try {
    return new URL(showcaseConfig().copilotPgUrl ?? "").username || "dock_copilot";
  } catch {
    return "dock_copilot";
  }
}

const cell = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return redact(v.length > 300 ? `${v.slice(0, 300)}…` : v);
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object") return redact(JSON.stringify(v)).slice(0, 300);
  return v;
};

/** Guard, then run. `params` are bound ($1, $2 ...) and never spliced into the text. */
export async function readOnlyQuery(sql: string, params: unknown[] = [], opts: { maxRows?: number; timeoutMs?: number; guard?: GuardResult } = {}): Promise<QueryResult | QueryFailure> {
  // Parameters ($1) are written by our own templates only; the guard refuses "$" in free text, so templates are
  // checked with their placeholders replaced by a literal.
  const g0 = opts.guard ?? guardSql(sql.replace(/\$\d+/g, "NULL"), { maxRows: opts.maxRows });
  if (!g0.ok) return { ok: false, sql, code: g0.code, reason: g0.reason, path: "direct" };
  const p = pool();
  if (!p) return { ok: false, sql, code: "not_configured", reason: "The read-only database user is not configured on this server (DOCK_COPILOT_PG_URL).", path: "direct" };
  const wrapped = `select * from (\n${sql.trim().replace(/;\s*$/, "")}\n) as answer limit ${g0.maxRows + 1}`;
  const timeout = Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const t0 = performance.now();
  let c;
  try {
    c = await p.connect();
  } catch (err) {
    return { ok: false, sql, code: "unreachable", reason: `Could not reach dock-pg as the read-only user: ${errMessage(err)}`, path: "direct" };
  }
  try {
    await c.query("begin transaction read only");
    await c.query(`set local statement_timeout = ${Math.round(timeout)}`);
    const r = await c.query({ text: wrapped, values: params });
    const rows = r.rows.slice(0, g0.maxRows).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cell(v)])));
    return { ok: true, sql: sql.trim(), columns: r.fields.map((f) => f.name), rows, truncated: r.rows.length > g0.maxRows, ms: Math.round(performance.now() - t0), path: "direct", as: readOnlyUser() };
  } catch (err) {
    const msg = errMessage(err);
    const code = /statement timeout|canceling statement/i.test(msg) ? "timeout" : /permission denied/i.test(msg) ? "permission" : /read-only transaction/i.test(msg) ? "write" : "query_failed";
    return { ok: false, sql, code, reason: code === "timeout" ? `The query ran past the ${timeout / 1000} s limit and was stopped.` : redact(msg), path: "direct" };
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}
