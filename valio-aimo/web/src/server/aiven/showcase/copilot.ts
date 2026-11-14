import { randomUUID } from "node:crypto";
import { showcaseConfig } from "./config";
import { mcpCall, mcpStatus, type McpStatus } from "./aiven-mcp";
import { aivenApi } from "./aiven-api";
import { readOnlyQuery, readOnlyDbConfigured } from "./readonly-db";
import { redactDeep } from "./redact";
import { guardSql } from "./sql-guard";
import { figuresFromRow, judgeAgent, scorecardSql } from "@/server/ops/scorecard";

/**
 * The operations copilot. Staff ask in plain words; the answer is COMPUTED from data on Aiven, never written by a
 * model: each question is matched to a reviewed query (or staff type a SELECT themselves), the query runs read-only,
 * and the sentence is built by code from the rows that came back. The query and the rows are shown under the
 * answer. A question no query covers gets "The data does not say", with what it can answer instead.
 *
 * Paths, named on every card:
 *   aiven-mcp   Aiven's MCP server (read-only token): service state, logs, metrics; SQL when the token allows it
 *   direct      PostgreSQL as dock_copilot (one view, read-only, 3 s, 200 rows) and the Aiven REST API read-only
 */
export type Step = {
  kind: "sql" | "mcp" | "api";
  label: string;
  /** The query or call exactly as it ran. */
  query: string;
  path: "aiven-mcp" | "direct";
  as?: string;
  ms?: number;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  error?: string;
};

export type AnswerCard = {
  id: string;
  question: string;
  at: string;
  answerable: boolean;
  answer: string;
  /** The path that produced the answer. */
  path: "aiven-mcp" | "direct" | "mixed" | "none";
  pathNote: string;
  template?: string;
  steps: Step[];
  refused?: { code: string; reason: string };
};

const NOT_SAID = "The data does not say.";

// ---------- time windows: a fixed set, so nothing typed reaches the SQL text ----------

type Window = { sql: string; words: string };
export function windowOf(q: string): Window {
  const s = q.toLowerCase();
  const m = /last\s+(\d{1,6})\s*(minute|min|hour|h|day|d)s?\b/.exec(s);
  if (m) {
    const n = Math.max(1, Math.min(Number(m[1]), m[2].startsWith("d") ? 30 : m[2].startsWith("h") ? 720 : 1440));
    const unit = m[2].startsWith("m") ? "minutes" : m[2].startsWith("h") ? "hours" : "days";
    return { sql: `now() - interval '${n} ${unit}'`, words: `in the last ${n} ${n === 1 ? unit.slice(0, -1) : unit}` };
  }
  if (/last hour|past hour|this hour|tunnin/.test(s)) return { sql: "now() - interval '1 hour'", words: "in the last hour" };
  if (/today|tänään/.test(s)) return { sql: "date_trunc('day', now())", words: "today (UTC)" };
  if (/yesterday/.test(s)) return { sql: "date_trunc('day', now()) - interval '1 day'", words: "since yesterday (UTC)" };
  if (/week|7 days/.test(s)) return { sql: "now() - interval '7 days'", words: "in the last 7 days" };
  if (/ever|all time|so far|in total/.test(s)) return { sql: "'-infinity'::timestamptz", words: "so far" };
  return { sql: "now() - interval '24 hours'", words: "in the last 24 hours" };
}

/** An agent name or id typed by staff, reduced to characters that can sit in a LIKE pattern. */
export function agentTerm(q: string): string | undefined {
  const id = /\b(agent_[a-z0-9_]+)\b/i.exec(q)?.[1];
  if (id) return id.toLowerCase();
  const quoted = /["“']([^"”']{2,40})["”']/.exec(q)?.[1];
  const after = /\b(?:agent|by|of)\s+([a-z0-9äöå_-]{3,40})\b/i.exec(q)?.[1];
  const raw = (quoted ?? after ?? "").toLowerCase();
  if (!raw || ["x", "the", "each", "every", "which", "did", "most", "needed", "all"].includes(raw)) return undefined;
  const clean = raw.replace(/[^a-z0-9_]/g, "");
  return clean.length >= 3 ? clean : undefined;
}

// ---------- the questions it knows ----------

type Ctx = { q: string; w: Window };
type Plan = {
  id: string;
  title: string;
  match: (q: string) => boolean;
  run: (c: Ctx) => Promise<{ steps: Step[]; answer: string; answerable?: boolean }>;
};

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const eur = (v: number) => `€${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function sqlStep(label: string, sql: string): Promise<Step> {
  const st = await mcpStatus();
  if (st.sql) {
    const g = guardSql(sql);
    if (!g.ok) return { kind: "sql", label, query: sql, path: "aiven-mcp", columns: [], rows: [], error: g.reason };
    const cfg = showcaseConfig();
    const r = await mcpCall("aiven_pg_read", { project: cfg.project, service_name: "dock-pg", query: g.wrapped, limit: g.maxRows, reasoning: `AimoPilot operations copilot: ${label}` });
    if (r.ok) {
      const data = r.data as { rows?: Record<string, unknown>[]; columns?: string[] } | Record<string, unknown>[] | undefined;
      const rows = (Array.isArray(data) ? data : (data?.rows ?? [])).slice(0, g.maxRows);
      return { kind: "sql", label, query: sql, path: "aiven-mcp", as: "Aiven MCP aiven_pg_read (read-only)", ms: r.ms, columns: rows[0] ? Object.keys(rows[0]) : [], rows, truncated: rows.length >= g.maxRows };
    }
    // fall through to the direct path, which says so on the card
  }
  const r = await readOnlyQuery(sql);
  if (!r.ok) return { kind: "sql", label, query: sql, path: "direct", as: "dock_copilot", columns: [], rows: [], error: r.reason };
  return { kind: "sql", label, query: r.sql, path: "direct", as: r.as, ms: r.ms, columns: r.columns, rows: r.rows, truncated: r.truncated };
}

const PLANS: Plan[] = [
  {
    id: "agents_failing",
    title: "Which agents are failing",
    match: (q) => /(agent|who).*(fail|struggl|misbehav|perform|doing|unhealthy|problem)|scorecard|(fail|failing|struggl).*(agent)/.test(q),
    run: async ({ w }) => {
      const win = /hour/.test(w.words) ? "1h" : /24|day|today/.test(w.words) ? "today" : "today";
      const s = await sqlStep("the agent scorecard", scorecardSql(win));
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      const rows = s.rows.map((r) => judgeAgent(figuresFromRow(r), { label: String(r.agent_id), orgName: "", kind: "" }));
      const failing = rows.filter((r) => r.status === "failing");
      const escalating = rows.filter((r) => r.status === "escalating");
      if (!rows.length) return { steps: [s], answer: `No agent came to the gate ${win === "1h" ? "in the last hour" : "today"}.` };
      if (!failing.length) return { steps: [s], answer: `No agent is failing ${win === "1h" ? "in the last hour" : "today"}: ${rows.filter((r) => r.status === "performing").length} performing, ${escalating.length} escalating, of ${rows.length}. Statuses are decided in code from these rows (ops/scorecard.ts).` };
      return { steps: [s], answer: `${failing.length} failing: ${failing.map((r) => `${r.agentId} (${r.reason.replace(/^Failing: /, "").replace(/\.$/, "")})`).join("; ")}. A person decides whether to suspend it, in Control.` };
    },
  },
  {
    id: "agents_escalating",
    title: "Which agents need a person most often",
    match: (q) => /need(s|ed)? a person|most often|escalat\w* (most|often)|(which|who).*(escalat|sign.?off)/.test(q) && !/waiting|pending|queue/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep(
        "escalations by agent",
        `select agent_id,
  count(*) filter (where kind = 'gate.escalated') as to_a_person,
  count(*) filter (where kind in ('gate.allowed', 'gate.escalated', 'gate.refused')) as decisions,
  count(*) filter (where kind = 'gate.escalated' and rule = 'per_order_limit') as over_limit,
  count(*) filter (where kind = 'approval.granted') as approved,
  count(*) filter (where kind = 'approval.denied') as declined
from telemetry.ops_events
where agent_id is not null and ts > ${w.sql}
group by 1 having count(*) filter (where kind = 'gate.escalated') > 0
order by 2 desc, 3 asc`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      if (!s.rows.length) return { steps: [s], answer: `No agent needed a person ${w.words}.` };
      const top = s.rows[0];
      const rate = n(top.decisions) ? Math.round((n(top.to_a_person) / n(top.decisions)) * 100) : 0;
      return { steps: [s], answer: `${top.agent_id} needed a person most: ${n(top.to_a_person)} of ${n(top.decisions)} decisions (${rate} %), ${n(top.over_limit)} over its limit, ${n(top.approved)} approved and ${n(top.declined)} declined ${w.words}.${n(top.over_limit) && !n(top.declined) ? " Every one was approved: its limit may be too tight for what the kitchen asks, a suggestion to the kitchen rather than a fault." : ""}` };
    },
  },
  {
    id: "waiting_signoff",
    title: "What is waiting for sign-off",
    match: (q) => /(waiting|pending|queue|wait|open).*(sign|approv|person)|(sign.?off|approval)s?.*(waiting|pending|open)/.test(q),
    run: async () => {
      const s = await sqlStep(
        "sign-offs asked and not answered",
        `with asked as (select order_id, agent_id, min(ts) as at from telemetry.ops_events where kind = 'approval.requested' and ts > now() - interval '2 days' and order_id is not null group by 1, 2),
done as (select distinct order_id from telemetry.ops_events where kind in ('approval.granted', 'approval.denied') and order_id is not null)
select asked.order_id, asked.agent_id, asked.at as asked_at, round(extract(epoch from now() - asked.at) / 60) as waiting_min
from asked left join done using (order_id) where done.order_id is null order by asked.at`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      if (!s.rows.length) return { steps: [s], answer: "Nothing is waiting for a person's sign-off." };
      const oldest = s.rows[0];
      return { steps: [s], answer: `${s.rows.length} order${s.rows.length === 1 ? "" : "s"} waiting for a person; the oldest, ${oldest.order_id} from ${oldest.agent_id}, for ${n(oldest.waiting_min)} min. Only the person the kitchen's mandate names can sign it, on their own phone.` };
    },
  },
  {
    id: "refusals_by_rule",
    title: "Refusals by rule",
    match: (q) => /refus|block|reject|kiel|hylä|turned away/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep(
        "refusals by rule",
        `select coalesce(rule, '(no rule named)') as rule, count(*) as refusals, count(distinct agent_id) as agents, max(ts) as last_at
from telemetry.ops_events
where kind = 'gate.refused' and ts > ${w.sql}
group by 1 order by 2 desc`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      const total = s.rows.reduce((a, r) => a + n(r.refusals), 0);
      if (!total) return { steps: [s], answer: `No refusals ${w.words}.` };
      const top = s.rows[0];
      const rest = s.rows.slice(1, 3).map((r) => `${r.rule} (${n(r.refusals)})`);
      return { steps: [s], answer: `${total} refusal${total === 1 ? "" : "s"} ${w.words}. Most by ${top.rule} (${n(top.refusals)})${rest.length ? `, then ${rest.join(", ")}` : ""}.` };
    },
  },
  {
    id: "signoffs_by_agent",
    title: "Sign-offs by agent",
    match: (q) => /sign.?off|approv|escalat|hyväksy|human/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep(
        "sign-offs by agent",
        `select coalesce(agent_id, '(unattributed)') as agent_id,
  count(*) filter (where kind = 'approval.requested') as asked,
  count(*) filter (where kind = 'approval.granted') as granted,
  count(*) filter (where kind = 'approval.denied') as denied
from telemetry.ops_events
where kind like 'approval.%' and ts > ${w.sql}
group by 1 order by 2 desc, 3 desc`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      const asked = s.rows.reduce((a, r) => a + n(r.asked), 0);
      if (!asked) return { steps: [s], answer: `No order needed a sign-off ${w.words}.` };
      const top = s.rows[0];
      return { steps: [s], answer: `${asked} sign-off${asked === 1 ? "" : "s"} asked ${w.words}. ${top.agent_id} needed the most: ${n(top.asked)} (${n(top.granted)} granted, ${n(top.denied)} declined).` };
    },
  },
  {
    id: "agent_activity",
    title: "Everything one agent did",
    match: (q) => /(everything|what did|activity|history|show me).*(agent|did)|\bagent_[a-z0-9_]+/.test(q),
    run: async ({ q, w }) => {
      const term = agentTerm(q);
      if (!term) {
        const s = await sqlStep("agents seen", `select agent_id, count(*) as events, max(ts) as last_at from telemetry.ops_events where agent_id is not null and ts > ${w.sql} group by 1 order by 2 desc`);
        return { steps: [s], answer: s.rows.length ? `Which agent? ${s.rows.length} agents acted ${w.words}; name one (for example ${s.rows[0].agent_id}).` : `No agent acted ${w.words}.`, answerable: s.rows.length > 0 };
      }
      const s = await sqlStep(
        `events of agents matching "${term}"`,
        `select ts, agent_id, kind, rule, request_id, order_id, value, summary
from telemetry.ops_events
where agent_id like '%${term}%' and ts > ${w.sql}
order by ts desc`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      if (!s.rows.length) return { steps: [s], answer: `${NOT_SAID} No agent matching "${term}" acted ${w.words}.`, answerable: false };
      const kinds = new Map<string, number>();
      for (const r of s.rows) kinds.set(String(r.kind), (kinds.get(String(r.kind)) ?? 0) + 1);
      const agents = [...new Set(s.rows.map((r) => r.agent_id))];
      const summary = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${c} ${k}`).join(", ");
      return { steps: [s], answer: `${agents.join(", ")}: ${s.rows.length}${s.truncated ? "+" : ""} events ${w.words} (${summary}). Newest first below; each request id opens in Trace.` };
    },
  },
  {
    id: "cache_savings",
    title: "Is the live-price cache saving calls",
    match: (q) => /cache|valkey|saving|saved|live.?price|partner api|välimuisti/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep(
        "live-price answers: cache vs partner API",
        `select count(*) filter (where kind = 'partner_api.cache_hit') as from_cache,
  count(*) filter (where kind = 'partner_api.call') as partner_calls,
  coalesce(round(avg(value) filter (where kind = 'partner_api.call')), 0) as avg_partner_ms
from telemetry.ops_events
where kind in ('partner_api.cache_hit', 'partner_api.call') and ts > ${w.sql}`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      const hit = n(s.rows[0]?.from_cache);
      const call = n(s.rows[0]?.partner_calls);
      if (hit + call === 0) return { steps: [s], answer: `No live price or availability was asked for ${w.words}, so there is nothing to save yet.` };
      const pct = Math.round((hit / (hit + call)) * 100);
      return { steps: [s], answer: `${hit > 0 ? "Yes" : "Not yet"}: ${hit} of ${hit + call} live-price answers ${w.words} came from the Valkey cache (${pct}%), so the partner's API was called ${call} times instead of ${hit + call}${call ? ` (about ${n(s.rows[0]?.avg_partner_ms)} ms each)` : ""}.` };
    },
  },
  {
    id: "health",
    title: "Is anything unhealthy",
    match: (q) => /health|unhealthy|down\b|broken|wrong|status|running|outage|alive|ok\?/.test(q),
    run: async () => healthPlan(),
  },
  {
    id: "orders",
    title: "Orders and value",
    match: (q) => /order|tilau|revenue|value|sold|committed/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep(
        "orders committed",
        `select count(*) filter (where kind = 'order.committed') as committed,
  coalesce(sum(value) filter (where kind = 'order.committed'), 0) as value_eur,
  count(*) filter (where kind = 'gate.allowed') as allowed_alone,
  count(*) filter (where kind = 'gate.escalated') as sent_to_person,
  count(*) filter (where kind = 'gate.refused') as refused
from telemetry.ops_events
where ts > ${w.sql}`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      const r = s.rows[0] ?? {};
      return { steps: [s], answer: `${n(r.committed)} orders committed ${w.words}, worth ${eur(n(r.value_eur))}. The gate let ${n(r.allowed_alone)} through alone, sent ${n(r.sent_to_person)} to a person and refused ${n(r.refused)}.` };
    },
  },
  {
    id: "busiest_agents",
    title: "Most active agents",
    match: (q) => /(which|most|busiest|top).*(agent)|agents? (at|seen)/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep(
        "events by agent",
        `select agent_id, count(*) as events, count(distinct request_id) as requests,
  count(*) filter (where kind = 'gate.refused') as refused, max(ts) as last_at
from telemetry.ops_events where agent_id is not null and ts > ${w.sql}
group by 1 order by 2 desc`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      if (!s.rows.length) return { steps: [s], answer: `No agent acted ${w.words}.` };
      return { steps: [s], answer: `${s.rows.length} agents acted ${w.words}; the busiest was ${s.rows[0].agent_id} with ${n(s.rows[0].events)} events over ${n(s.rows[0].requests)} requests.` };
    },
  },
  {
    id: "crash_test",
    title: "Crash-test scores",
    match: (q) => /crash|licen|score|rating/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep("crash-test scores", `select ts, agent_id, value as score, run from telemetry.ops_events where kind = 'crashtest.score' and ts > ${w.sql} order by ts desc`);
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      if (!s.rows.length) return { steps: [s], answer: `${NOT_SAID} No crash-test run reported a score ${w.words}.`, answerable: false };
      return { steps: [s], answer: `${s.rows.length} crash-test scores ${w.words}; the latest: ${s.rows[0].agent_id ?? "an agent"} scored ${n(s.rows[0].score)}.` };
    },
  },
  {
    id: "model_spend",
    title: "Model spend",
    match: (q) => /model|llm|spend|token|cost of (the )?ai|gemini|claude/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep(
        "model spend per day (latest snapshot of each day)",
        `select date_trunc('day', ts) as day, max(value) as usd, max(products) as calls
from telemetry.ops_events where kind = 'usage.model' and ts > ${w.sql}
group by 1 order by 1 desc`,
      );
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      if (!s.rows.length) return { steps: [s], answer: `${NOT_SAID} No model-spend snapshot was written ${w.words}.`, answerable: false };
      return { steps: [s], answer: `Model spend ${w.words}: $${n(s.rows[0].usd).toFixed(4)} on the latest day, over ${n(s.rows[0].calls)} calls (the app's own estimate from token counts).` };
    },
  },
  {
    id: "stream",
    title: "Events through the stream",
    match: (q) => /event|stream|kafka|kind|pipeline|what happened/.test(q),
    run: async ({ w }) => {
      const s = await sqlStep("events by kind", `select kind, count(*) as events, max(ts) as last_at from telemetry.ops_events where ts > ${w.sql} and kind not like 'metric.%' group by 1 order by 2 desc`);
      if (s.error) return { steps: [s], answer: NOT_SAID, answerable: false };
      const total = s.rows.reduce((a, r) => a + n(r.events), 0);
      return { steps: [s], answer: total ? `${total} events reached telemetry.events ${w.words}, ${s.rows.length} kinds; the most common was ${s.rows[0].kind} (${n(s.rows[0].events)}).` : `No events ${w.words}.` };
    },
  },
  {
    id: "errors_log",
    title: "Recent app log lines",
    match: (q) => /log|error|exception|crash(ed)? the app/.test(q),
    run: async () => {
      const cfg = showcaseConfig();
      const r = await mcpCall("aiven_project_get_service_logs", { project: cfg.project, service_name: "dock-app", log_type: "application-run", limit: 40, sort_order: "desc" });
      const logs = ((r.ok ? (r.data as { logs?: { time?: string; msg?: string; severity?: string }[] })?.logs : []) ?? []).map((l) => ({ time: l.time, severity: l.severity || "", msg: String(l.msg ?? "").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 200) }));
      const step: Step = { kind: "mcp", label: "dock-app run log", query: `aiven_project_get_service_logs ${JSON.stringify({ service_name: "dock-app", log_type: "application-run", limit: 40 })}`, path: "aiven-mcp", as: "read-only token", ms: r.ms, columns: ["time", "severity", "msg"], rows: logs, error: r.ok ? undefined : r.error };
      if (!r.ok) return { steps: [step], answer: NOT_SAID, answerable: false };
      const bad = logs.filter((l) => /error|warn|fail/i.test(`${l.severity} ${l.msg}`));
      return { steps: [step], answer: bad.length ? `${bad.length} of the last ${logs.length} log lines mention an error or warning; the newest: "${bad[0].msg.slice(0, 120)}".` : `None of the last ${logs.length} dock-app log lines mention an error or warning.` };
    },
  },
];

/** Things the copilot will not read, said plainly instead of guessed. */
const PRIVATE = /\b(memory|memories|usual|prefer|preference|recipe|what does .* (usually|normally) (buy|order)|muisti)\b/;

async function healthPlan(): Promise<{ steps: Step[]; answer: string }> {
  const cfg = showcaseConfig();
  const steps: Step[] = [];
  let services: { service_name: string; service_type?: string; state: string; plan?: string }[] = [];
  const st = await mcpStatus();
  if (st.reachable) {
    const r = await mcpCall("aiven_service_list", { project: cfg.project });
    const list = r.ok ? ((r.data as { services?: typeof services })?.services ?? []) : [];
    services = list;
    steps.push({ kind: "mcp", label: "service state", query: `aiven_service_list ${JSON.stringify({ project: "<project>" })}`, path: "aiven-mcp", as: "read-only token", ms: r.ms, columns: ["service_name", "service_type", "state"], rows: list.map((s) => ({ service_name: s.service_name, service_type: s.service_type, state: s.state })), error: r.ok ? undefined : r.error });
  }
  if (!services.length && cfg.readToken && cfg.project) {
    const t0 = performance.now();
    try {
      const j = await aivenApi<{ services: typeof services }>(cfg.readToken, "GET", `/project/${cfg.project}/service`, { cacheMs: 10_000 });
      services = j.services;
      steps.push({ kind: "api", label: "service state", query: "GET /v1/project/<project>/service", path: "direct", as: "read-only token", ms: Math.round(performance.now() - t0), columns: ["service_name", "service_type", "plan", "state"], rows: services.map((s) => ({ service_name: s.service_name, service_type: s.service_type, plan: s.plan, state: s.state })) });
    } catch (err) {
      steps.push({ kind: "api", label: "service state", query: "GET /v1/project/<project>/service", path: "direct", columns: [], rows: [], error: err instanceof Error ? err.message : String(err) });
    }
  }
  const probes = await sqlStep(
    "latest probe of each service by the app",
    `select distinct on (rule) rule as service, ok, value as ms, ts as checked_at, detail
from telemetry.ops_events where kind = 'infra.check' and ts > now() - interval '2 hours'
order by rule, ts desc`,
  );
  steps.push(probes);
  const down = services.filter((s) => s.state !== "RUNNING");
  const failing = probes.rows.filter((r) => r.ok === false);
  if (!services.length && !probes.rows.length) return { steps, answer: NOT_SAID };
  const parts: string[] = [];
  parts.push(down.length ? `${down.map((s) => `${s.service_name} is ${s.state}`).join(", ")}` : services.length ? `all ${services.length} services are RUNNING` : "service state could not be read");
  if (probes.rows.length) parts.push(failing.length ? `the app's last probe failed for ${failing.map((r) => r.service).join(", ")}` : `the app reached ${probes.rows.map((r) => r.service).join(", ")} on its last probe`);
  else parts.push("the app wrote no probe in the last 2 hours");
  // The app's own alert table (ops/alerts.ts), evaluated in code every 30 s.
  let breaches: { title: string; detail: string; since: string }[] = [];
  try {
    const [{ getRuntime }, { alertsNow }] = await Promise.all([import("@/server/runtime"), import("@/server/ops/agent-watch")]);
    const a = await alertsNow(await getRuntime());
    breaches = a.breaches;
    steps.push({ kind: "api", label: "the app's alert table", query: "alertsNow(): the six thresholds in ops/alerts.ts over this server's last 15 minutes", path: "direct", as: "the app", columns: ["alert", "detail", "since"], rows: a.quiet ? [{ alert: "all quiet", detail: `${a.rules.length} rules`, since: a.at }] : a.breaches.map((b) => ({ alert: b.title, detail: b.detail, since: b.since })) });
  } catch {
    // the alert table is an addition; the services' state still answers
  }
  if (breaches.length) parts.push(`breaching: ${breaches.map((b) => `${b.title.toLowerCase()} (${b.detail})`).join("; ")}`);
  else parts.push("the app's alerts are all quiet");
  return { steps, answer: `${down.length || failing.length || breaches.length ? "Yes" : "Nothing unhealthy"}: ${parts.join("; ")}.` };
}

function pathOf(steps: Step[]): AnswerCard["path"] {
  const p = new Set(steps.filter((s) => !s.error || s.rows.length).map((s) => s.path));
  if (!p.size) return "none";
  return p.size > 1 ? "mixed" : [...p][0];
}

function pathNote(path: AnswerCard["path"], st: McpStatus): string {
  const mcp = st.orgEnabled === false ? "Aiven MCP is off for this organisation" : st.reachable ? (st.sql ? "Aiven MCP answered SQL read-only" : "Aiven MCP answers service state and logs; SQL goes the direct read-only way, because MCP's SQL tool needs a PG Editor permission a read-only token does not carry") : "Aiven MCP did not answer";
  if (path === "aiven-mcp") return `Answered through Aiven's MCP server with the read-only token. ${mcp}.`;
  if (path === "mixed") return `Service state through Aiven's MCP server; numbers from PostgreSQL as the read-only user dock_copilot. ${mcp}.`;
  if (path === "direct") return `Answered directly from Aiven: PostgreSQL as the read-only user dock_copilot (one view, read-only, 3 s, 200 rows) or the Aiven API with the read-only token. ${mcp}.`;
  return mcp;
}

export type AskOptions = { now?: Date };

/** One question in, one card out. Never throws for a bad question; the card says what happened. */
export async function ask(questionRaw: string): Promise<AnswerCard> {
  const question = (questionRaw ?? "").trim().slice(0, 500);
  const base = { id: randomUUID(), question, at: new Date().toISOString() };
  const st = await mcpStatus();
  if (!question) return { ...base, answerable: false, answer: "Ask a question.", path: "none", pathNote: "", steps: [] };
  const q = question.toLowerCase();

  // Staff may type their own SELECT; it goes through the same guard and the same read-only user.
  if (/^\s*(select|with|insert|update|delete|drop|alter|create|truncate|grant|copy|merge|call|do|set)\b/i.test(question)) {
    const g = guardSql(question);
    if (!g.ok) return { ...base, answerable: false, answer: `Refused before it reached the database: ${g.reason}`, path: "none", pathNote: "The guard runs in the app; the database user would refuse a write as well.", refused: { code: g.code, reason: g.reason }, steps: [{ kind: "sql", label: "your query", query: question, path: "direct", columns: [], rows: [], error: g.reason }] };
    const s = await sqlStep("your query", g.sql);
    const card: AnswerCard = { ...base, answerable: !s.error, answer: s.error ? `The database refused it: ${s.error}` : `${s.rows.length}${s.truncated ? " (cut at the row cap)" : ""} row${s.rows.length === 1 ? "" : "s"}${s.ms !== undefined ? ` in ${s.ms} ms` : ""}.`, path: pathOf([s]), pathNote: "", steps: [s] };
    card.pathNote = pathNote(card.path, st);
    if (s.error) card.refused = { code: "database", reason: s.error };
    return redactDeep(card);
  }

  if (PRIVATE.test(q)) {
    return { ...base, answerable: false, answer: `${NOT_SAID} A kitchen's memory (its usual amounts, its rules, what it prefers) stays with the kitchen; the copilot's database user cannot read it.`, path: "none", pathNote: "dock_copilot can read one view, telemetry.ops_events, which withholds intake steps that quote kitchen memory.", steps: [] };
  }

  const plan = PLANS.find((p) => p.match(q));
  if (!plan) {
    return {
      ...base,
      answerable: false,
      answer: `${NOT_SAID} Nothing on Aiven records that. It can answer: ${PLANS.map((p) => p.title.toLowerCase()).join("; ")}; or a SELECT over telemetry.ops_events.`,
      path: "none",
      pathNote: "No query was run, so nothing was guessed.",
      steps: [],
    };
  }
  if (!readOnlyDbConfigured() && !st.reachable && plan.id !== "health") {
    return { ...base, answerable: false, answer: `${NOT_SAID} Neither the read-only database user nor the Aiven MCP server is configured on this server.`, path: "none", pathNote: "Set DOCK_COPILOT_PG_URL and AIVEN_READONLY_TOKEN.", template: plan.id, steps: [] };
  }
  const out = await plan.run({ q, w: windowOf(q) });
  const path = pathOf(out.steps);
  return redactDeep({ ...base, answerable: out.answerable ?? true, answer: out.answer, path, pathNote: pathNote(path, st), template: plan.id, steps: out.steps });
}

/** The questions the box suggests. */
export const SUGGESTIONS = [
  "How many orders were refused in the last hour and by which rule?",
  "Which agents needed the most sign-offs today?",
  "Show me everything agent_laakso_aiven_01 did",
  "Is the live-price cache saving calls?",
  "Is anything unhealthy?",
  "How many orders were committed today?",
  "select kind, count(*) from telemetry.ops_events group by 1 order by 2 desc",
];
