import type { Pool } from "pg";
import { dailyUsage } from "@/server/limits";
import { errMessage, log } from "../env";
import type { RunWriter } from "./launcher";

/**
 * The showcase's own telemetry rows, written with the app's pool (never the copilot's read-only user):
 *   aiven_agent.run   a Managed Agent run started / finished from the portal (rule = preset, value = seconds)
 *   usage.model       this server's model spend today (value = USD, attrs.products = calls), once a minute when it changed
 */
export function telemetryWriter(pool: Pool | undefined): RunWriter | undefined {
  if (!pool) return undefined;
  return async (row) => {
    await pool.query(`insert into telemetry.events (source, kind, rule, agent_id, value, ok, attrs) values ('dock-app', $1, $2, $3, $4, $5, $6::jsonb)`, [row.kind, row.rule ?? null, "agent_laakso_aiven_01", row.value ?? null, row.ok ?? null, JSON.stringify(row.attrs)]);
  };
}

const g = globalThis as typeof globalThis & { __dockShowcaseUsage?: { timer: NodeJS.Timeout; last: string } };

export function ensureUsageFlusher(pool: Pool | undefined): void {
  if (!pool || g.__dockShowcaseUsage) return;
  const state = { last: "", timer: undefined as unknown as NodeJS.Timeout };
  const flush = async () => {
    const u = dailyUsage();
    const sig = `${u.day}|${u.llm.calls}|${u.llm.usd}`;
    if (sig === state.last || (u.llm.calls === 0 && state.last === "")) return;
    state.last = sig;
    await pool.query(`insert into telemetry.events (source, kind, value, attrs) values ('dock-app', 'usage.model', $1, $2::jsonb)`, [u.llm.usd, JSON.stringify({ products: u.llm.calls, day: u.day, detail: `max ${u.llm.maxCalls} calls / $${u.llm.maxUsd} a day` })]);
  };
  state.timer = setInterval(() => void flush().catch((err) => log("warn", "usage snapshot failed", { error: errMessage(err) })), 60_000);
  state.timer.unref();
  g.__dockShowcaseUsage = state;
  void flush().catch(() => undefined);
}

/** Runs counted in telemetry today, so the day's cap holds across restarts. */
export function runsTodayFrom(pool: Pool | undefined): (() => Promise<number>) | undefined {
  if (!pool) return undefined;
  return async () => {
    const r = await pool.query<{ n: string }>(`select count(*) as n from telemetry.events where kind = 'aiven_agent.run' and ok is null and ts > date_trunc('day', now())`);
    return Number(r.rows[0]?.n ?? 0);
  };
}
