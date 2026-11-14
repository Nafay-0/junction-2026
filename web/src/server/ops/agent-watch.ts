import { LedgerToActions, type ActionEvent } from "@/server/aiven/actions";
import { recentEvents } from "@/server/aiven/recent-events";
import { readOnlyDbConfigured, readOnlyQuery } from "@/server/aiven/showcase/readonly-db";
import { dailyUsage } from "@/server/limits";
import type { Runtime } from "@/server/runtime";
import { AlertBook, type AlertInputs, type AlertState } from "./alerts";
import { opsContext } from "./context";
import { AGENT_THRESHOLDS, TURN_GIVE_UP_S, WINDOWS, figuresFromEvents, figuresFromRow, judgeAgent, percentileCont, scorecardSql, type AgentFigures, type ScoreRow, type ScoreWindow } from "./scorecard";
import { waitingSignOffs, type Waiting } from "./views";

/**
 * The agent watch: the scorecard per agent, the escalation queue and the alerts, for the Agents page, the Platform
 * page and the operations copilot. The figures come from PostgreSQL when the read-only user is configured (the SQL
 * is returned with them), else from this server's ledger and recent events; statuses and alerts are plain code.
 */

const g = globalThis as typeof globalThis & { __dockEventsCache?: { n: number; recent: number; events: ActionEvent[] }; __dockAlertBook?: AlertBook; __dockAlertTimer?: NodeJS.Timeout };

/** This server's ledger as action events (the same mapping the stream uses), plus the model and search events it saw. */
export function localEvents(rt: Runtime): ActionEvent[] {
  const entries = rt.dock.ledger.readonly();
  const recent = recentEvents();
  const c = g.__dockEventsCache;
  if (c && c.n === entries.length && c.recent === recent.length) return c.events;
  const mapper = new LedgerToActions();
  const events: ActionEvent[] = [];
  for (const e of entries) {
    const ev = mapper.toEvent(e);
    if (ev) events.push(ev);
  }
  events.push(...recent);
  g.__dockEventsCache = { n: entries.length, recent: recent.length, events };
  return events;
}

export type Scorecard = {
  at: string;
  window: ScoreWindow;
  words: string;
  /** Where the figures came from: PostgreSQL's telemetry (all processes, the record) or this server's ledger. */
  source: "postgres" | "ledger";
  sourceNote: string;
  sql: string;
  thresholds: typeof AGENT_THRESHOLDS;
  rows: ScoreRow[];
  counts: Record<ScoreRow["status"], number>;
};

export async function agentScorecard(rt: Runtime, window: ScoreWindow = "today", opts: { source?: "postgres" | "ledger" } = {}): Promise<Scorecard> {
  const now = new Date();
  const sql = scorecardSql(window);
  let figures: AgentFigures[] | undefined;
  let source: Scorecard["source"] = "ledger";
  let sourceNote = "From this server's ledger and the events it saw since it started (the read-only database user is not configured here).";
  if (opts.source !== "ledger" && readOnlyDbConfigured()) {
    const r = await readOnlyQuery(sql, [], { maxRows: 500 });
    if (r.ok) {
      figures = r.rows.map(figuresFromRow);
      source = "postgres";
      sourceNote = `From telemetry in PostgreSQL, read as ${r.as} in ${r.ms} ms: every process, the record.`;
    } else sourceNote = `PostgreSQL did not answer (${r.reason.slice(0, 120)}): from this server's ledger instead.`;
  }
  figures ??= figuresFromEvents(localEvents(rt), WINDOWS[window].since(now), now);
  const ctx = await opsContext(rt);
  const seen = new Set(figures.map((f) => f.agentId));
  const viaDoor = new Set(ctx.door.all().filter((c) => c.via === "mcp" || c.via === "rest").map((c) => c.agentId));
  const empty = (agentId: string): AgentFigures => ({ agentId, requests: 0, alone: 0, escalated: 0, overLimit: 0, refused: 0, committed: 0, granted: 0, denied: 0, proposals: 0, corrections: 0, turns: 0, failedTurns: 0, modelFallbacks: 0, liveLookups: 0, productsPriced: 0, spendUsd: 0, decideP50S: null, decideP90S: null, turnP50S: null, turnP90S: null, refusedRules: [], lastRefusedRequest: null, lastAt: null });
  const all = [...figures, ...[...ctx.agents.keys()].filter((id) => !seen.has(id)).map(empty)];
  const rows = all.map((f) => {
    const a = ctx.agents.get(f.agentId);
    const suspended = a ? !!ctx.suspensions.find(a.agentId, a.orgId) : false;
    const outside = a && a.kind !== "outside" && viaDoor.has(a.agentId);
    return judgeAgent(f, { label: a?.label ?? f.agentId, orgName: a?.orgName ?? "unknown", kind: outside ? `outside (${a!.kind})` : (a?.kind ?? (f.agentId.startsWith("crash") ? "crash-test" : "outside")), suspended });
  });
  const order: Record<ScoreRow["status"], number> = { failing: 0, escalating: 1, performing: 2, quiet: 3 };
  rows.sort((x, y) => order[x.status] - order[y.status] || (y.lastAt ?? "").localeCompare(x.lastAt ?? ""));
  const counts = { failing: 0, escalating: 0, performing: 0, quiet: 0 };
  for (const r of rows) counts[r.status]++;
  return { at: now.toISOString(), window, words: WINDOWS[window].words, source, sourceNote, sql, thresholds: AGENT_THRESHOLDS, rows, counts };
}

// ---------- the escalation queue ----------

export type QueueItem = Waiting & { waitingMin: number; overThreshold: boolean };
export type EscalationQueue = {
  at: string;
  items: QueueItem[];
  thresholdMin: number;
  /** How long sign-offs took, from the request to the person's answer, in this server's ledger (today). */
  signOff: { decided: number; p50Min: number | null; p90Min: number | null; granted: number; declined: number };
  sql: string;
};

export const SIGNOFF_WAIT_MIN = 30;

/** The sign-off times in SQL, for the record (the same definition as the queue's figures). */
export const SIGNOFF_SQL = `with asked as (select order_id, min(ts) as at from telemetry.ops_events where kind = 'approval.requested' and ts > date_trunc('day', now()) and order_id is not null group by 1),
done as (select order_id, min(ts) as at, bool_or(kind = 'approval.granted') as granted from telemetry.ops_events where kind in ('approval.granted', 'approval.denied') and order_id is not null group by 1)
select count(done.order_id) as decided,
  round((percentile_cont(0.5) within group (order by extract(epoch from done.at - asked.at)) / 60)::numeric, 1) as p50_min,
  round((percentile_cont(0.9) within group (order by extract(epoch from done.at - asked.at)) / 60)::numeric, 1) as p90_min,
  count(*) filter (where done.granted) as granted, count(*) filter (where done.granted = false) as declined
from asked join done using (order_id)`;

export async function escalationQueue(rt: Runtime): Promise<EscalationQueue> {
  const now = Date.now();
  const waiting = await waitingSignOffs(rt);
  const items = waiting.map((w) => {
    const waitingMin = Math.max(0, (now - new Date(w.requestedAt).getTime()) / 60_000);
    return { ...w, waitingMin: Math.round(waitingMin * 10) / 10, overThreshold: waitingMin > SIGNOFF_WAIT_MIN };
  });
  const since = WINDOWS.today.since(new Date(now)).getTime();
  const asked = new Map<string, number>();
  const durations: number[] = [];
  let granted = 0;
  let declined = 0;
  for (const e of rt.dock.ledger.readonly()) {
    if (!e.orderId || new Date(e.at).getTime() <= since) continue;
    if (e.type === "approval_requested" && !asked.has(e.orderId)) asked.set(e.orderId, new Date(e.at).getTime());
    if (e.type === "approval" && asked.has(e.orderId)) {
      durations.push((new Date(e.at).getTime() - asked.get(e.orderId)!) / 60_000);
      asked.delete(e.orderId);
      if ((e.data as { decision?: string }).decision === "approved") granted++;
      else declined++;
    }
  }
  return { at: new Date(now).toISOString(), items, thresholdMin: SIGNOFF_WAIT_MIN, signOff: { decided: durations.length, p50Min: percentileCont(durations, 0.5), p90Min: percentileCont(durations, 0.9), granted, declined }, sql: SIGNOFF_SQL };
}

// ---------- alerts ----------

const EVERY_S = 30;

/** The alerts' inputs from this server's own record: the last 15 minutes of turns and searches, today's spend, the queue. */
export async function alertInputs(rt: Runtime): Promise<AlertInputs> {
  const now = Date.now();
  const from = now - 15 * 60_000;
  const events = localEvents(rt).filter((e) => new Date(e.at).getTime() > from);
  const turns = new Map<string, { s?: number; d?: number }>();
  for (const e of events) {
    const id = (e.attrs as { turnId?: string } | undefined)?.turnId;
    if (!id || (e.kind !== "turn.started" && e.kind !== "turn.done")) continue;
    const t = turns.get(id) ?? {};
    if (e.kind === "turn.started") t.s = new Date(e.at).getTime();
    else t.d = new Date(e.at).getTime();
    turns.set(id, t);
  }
  const done = [...turns.values()].filter((t) => t.s !== undefined && t.d !== undefined);
  const failed = [...turns.values()].filter((t) => t.s !== undefined && t.d === undefined && t.s < now - TURN_GIVE_UP_S * 1000).length;
  const searches = events.filter((e) => e.kind === "search.done");
  const fallbacks = searches.filter((e) => ((e.attrs as { facts?: { fallback?: boolean } } | undefined)?.facts?.fallback ?? false) === true).length;
  const usage = dailyUsage().llm;
  const waiting = await waitingSignOffs(rt).catch(() => [] as Waiting[]);
  const oldest = waiting.length ? Math.max(...waiting.map((w) => (now - new Date(w.requestedAt).getTime()) / 60_000)) : null;
  let kafkaLag: number | null = null;
  if (rt.aiven.switches.actions === "kafka") {
    kafkaLag = await import("@/server/aiven/showcase/stream")
      .then((m) => m.lag())
      .then((l) => l.totalLag)
      .catch(() => null);
  }
  return { turnSeconds: done.map((t) => (t.d! - t.s!) / 1000), failedTurns: failed, searches: searches.length, searchFallbacks: fallbacks, spendUsd: usage.usd, capUsd: usage.maxUsd, oldestWaitMin: oldest, waiting: waiting.length, kafkaLag };
}

/** The current alerts; starts the 30-second evaluation the first time it is asked. */
export async function alertsNow(rt: Runtime): Promise<AlertState> {
  const book = (g.__dockAlertBook ??= new AlertBook());
  if (!g.__dockAlertTimer && !process.env.VITEST) {
    g.__dockAlertTimer = setInterval(() => {
      void alertInputs(rt)
        .then((x) => book.update(x, new Date(), EVERY_S))
        .catch(() => undefined);
    }, EVERY_S * 1000);
    g.__dockAlertTimer.unref?.();
  }
  const cur = book.current();
  if (cur && Date.now() - new Date(cur.at).getTime() < EVERY_S * 1000) return cur;
  return book.update(await alertInputs(rt), new Date(), EVERY_S);
}
