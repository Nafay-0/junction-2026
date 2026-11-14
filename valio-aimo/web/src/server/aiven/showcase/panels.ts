import { dailyUsage } from "@/server/limits";
import { readOnlyQuery, type QueryFailure, type QueryResult } from "./readonly-db";

/**
 * The observability panels of the operations portal: the Grafana dashboard's questions, drawn from the same table
 * (telemetry.events, through the read-only view telemetry.ops_events, as dock_copilot), plus what an operations
 * lead also asks: how long sign-offs wait, who gets refused most, whether the pipeline keeps up.
 * Every panel carries the SQL it ran, so each number can be checked.
 */
export type Range = "1h" | "24h" | "7d";
const RANGES: Record<Range, { since: string; bucket: string; label: string }> = {
  "1h": { since: "now() - interval '1 hour'", bucket: "minute", label: "last hour, per minute" },
  "24h": { since: "now() - interval '24 hours'", bucket: "hour", label: "last 24 hours, per hour" },
  "7d": { since: "now() - interval '7 days'", bucket: "day", label: "last 7 days, per day" },
};

export type Panel = { id: string; title: string; sql: string; rows: Record<string, unknown>[]; error?: string; ms?: number };

/** Every bucket of the range, also the empty ones, so a quiet hour shows as a gap and not as nothing. */
const series = (r: (typeof RANGES)[Range], cols: string, kinds: string) => `with b as (
  select generate_series(date_trunc('${r.bucket}', ${r.since}), date_trunc('${r.bucket}', now()), interval '1 ${r.bucket}') as t
)
select b.t, ${cols}
from b left join telemetry.ops_events e on date_trunc('${r.bucket}', e.ts) = b.t and e.kind in ${kinds} and e.ts > ${r.since}
group by 1 order by 1`;

const QUERIES = (r: (typeof RANGES)[Range]): Record<string, { title: string; sql: string }> => ({
  totals: {
    title: "Totals",
    sql: `select
  count(*) filter (where kind = 'order.committed') as orders,
  coalesce(sum(value) filter (where kind = 'order.committed'), 0) as value_eur,
  count(*) filter (where kind = 'gate.allowed') as allowed_alone,
  count(*) filter (where kind = 'approval.requested') as signoffs_asked,
  count(*) filter (where kind = 'approval.granted') as signoffs_granted,
  count(*) filter (where kind = 'approval.denied') as signoffs_denied,
  count(*) filter (where kind = 'gate.refused') as refused,
  count(*) filter (where kind = 'request.opened') as requests,
  count(*) filter (where kind = 'partner_api.cache_hit') as cache_hits,
  count(*) filter (where kind = 'partner_api.call') as partner_calls,
  coalesce(sum(products) filter (where kind = 'lookup.live'), 0) as products_priced,
  count(distinct request_id) filter (where kind = 'lookup.live') as requests_priced,
  count(distinct agent_id) as agents
from telemetry.ops_events where ts > ${r.since}`,
  },
  timeline: {
    title: "Gate decisions over time",
    sql: series(r, `count(e.id) filter (where e.kind = 'gate.allowed') as allowed,
  count(e.id) filter (where e.kind = 'gate.escalated') as to_person,
  count(e.id) filter (where e.kind = 'gate.refused') as refused,
  count(e.id) filter (where e.kind = 'order.committed') as committed`, "('gate.allowed', 'gate.escalated', 'gate.refused', 'order.committed')"),
  },
  refusals: {
    title: "Refusals by rule",
    sql: `select coalesce(rule, '(no rule named)') as rule, count(*) as n, count(distinct agent_id) as agents
from telemetry.ops_events where kind = 'gate.refused' and ts > ${r.since} group by 1 order by 2 desc`,
  },
  escalations: {
    title: "Why orders went to a person",
    sql: `select coalesce(rule, '(no rule named)') as rule, count(*) as n
from telemetry.ops_events where kind = 'gate.escalated' and ts > ${r.since} group by 1 order by 2 desc`,
  },
  signoffWait: {
    title: "How long sign-offs waited",
    sql: `with asked as (select order_id, min(ts) as at from telemetry.ops_events where kind = 'approval.requested' and ts > ${r.since} and order_id is not null group by 1),
done as (select order_id, min(ts) as at, bool_or(kind = 'approval.granted') as granted from telemetry.ops_events where kind in ('approval.granted', 'approval.denied') and order_id is not null group by 1)
select count(*) as asked, count(done.order_id) as decided, count(*) filter (where done.order_id is null) as waiting,
  round(percentile_cont(0.5) within group (order by extract(epoch from done.at - asked.at))::numeric, 1) as median_s,
  round(max(extract(epoch from done.at - asked.at))::numeric, 1) as max_s
from asked left join done on done.order_id = asked.order_id`,
  },
  agents: {
    title: "Agents: activity, sign-offs and refusals",
    sql: `select agent_id, count(distinct request_id) as requests,
  count(*) filter (where kind = 'order.committed') as committed,
  coalesce(sum(value) filter (where kind = 'order.committed'), 0) as value_eur,
  count(*) filter (where kind = 'approval.requested') as signoffs,
  count(*) filter (where kind = 'gate.refused') as refused
from telemetry.ops_events where agent_id is not null and ts > ${r.since}
group by 1 order by 2 desc, 4 desc`,
  },
  cache: {
    title: "Live price: cache against partner calls",
    sql: series(r, `count(e.id) filter (where e.kind = 'partner_api.cache_hit') as from_cache,
  count(e.id) filter (where e.kind = 'partner_api.call') as partner_calls`, "('partner_api.cache_hit', 'partner_api.call')"),
  },
  spend: {
    title: "Model spend per day",
    sql: `select date_trunc('day', ts) as day, max(value) as usd, max(products) as calls
from telemetry.ops_events where kind = 'usage.model' and ts > now() - interval '7 days' group by 1 order by 1`,
  },
  health: {
    title: "Service health (the app's own probes)",
    sql: `select distinct on (rule) rule as service, ok, value as ms, ts as checked_at, detail
from telemetry.ops_events where kind = 'infra.check' and ts > now() - interval '6 hours'
order by rule, ts desc`,
  },
  pipeline: {
    title: "Pipeline: events in and out",
    sql: series(r, `coalesce(sum(e.value) filter (where e.kind = 'metric.events.published'), 0) as published,
  coalesce(sum(e.value) filter (where e.kind = 'metric.events.consumed'), 0) as consumed,
  coalesce(sum(e.value) filter (where e.kind = 'metric.events.dropped'), 0) as dropped`, "('metric.events.published', 'metric.events.consumed', 'metric.events.dropped')"),
  },
  search: {
    title: "Search right now",
    sql: `select count(*) as searches,
  round(percentile_cont(0.5) within group (order by (facts->>'embed_ms')::float8)::numeric) as embed_p50,
  round(percentile_cont(0.9) within group (order by (facts->>'embed_ms')::float8)::numeric) as embed_p90,
  round(percentile_cont(0.5) within group (order by (facts->>'recall_ms')::float8)::numeric) as recall_p50,
  round(percentile_cont(0.9) within group (order by (facts->>'recall_ms')::float8)::numeric) as recall_p90,
  round(percentile_cont(0.5) within group (order by (facts->>'judge_ms')::float8)::numeric) as judge_p50,
  round(percentile_cont(0.9) within group (order by (facts->>'judge_ms')::float8)::numeric) as judge_p90,
  round(percentile_cont(0.5) within group (order by (facts->>'total_ms')::float8)::numeric) as total_p50,
  round(percentile_cont(0.9) within group (order by (facts->>'total_ms')::float8)::numeric) as total_p90,
  count(*) filter (where facts->>'backend' = 'opensearch') as on_opensearch,
  count(*) filter (where facts->>'backend' like 'memory%') as in_memory,
  count(*) filter (where (facts->>'fallback')::boolean) as fallbacks,
  count(*) filter (where (facts->>'judge_missed')::boolean) as judge_missed,
  round((1000 * coalesce(avg((facts->>'cost_usd')::float8), 0))::numeric, 3) as usd_per_1000,
  count(*) filter (where (facts->>'not_sold')::boolean) as not_sold
from telemetry.ops_events where kind = 'search.done' and ts > ${r.since}`,
  },
  conversation: {
    title: "The conversation",
    sql: `with t as (
  select turn_id,
    min(ts) filter (where kind = 'turn.started') as started,
    min(ts) filter (where kind = 'turn.done') as done,
    max(facts->>'outcome') filter (where kind = 'turn.done') as outcome,
    max(facts->>'input') filter (where kind = 'turn.started') as input
  from telemetry.ops_events where kind in ('turn.started', 'turn.done') and ts > ${r.since} and turn_id is not null group by 1
), m as (
  select turn_id, count(*) as calls, sum(cost_usd) as usd from telemetry.ops_events where kind = 'agent.model' and ts > ${r.since} and turn_id is not null group by 1
)
select count(*) as turns,
  round(percentile_cont(0.5) within group (order by extract(epoch from done - started))::numeric, 1) as turn_p50_s,
  round(percentile_cont(0.9) within group (order by extract(epoch from done - started))::numeric, 1) as turn_p90_s,
  count(*) filter (where done is null and started < now() - interval '150 seconds') as failed,
  count(*) filter (where outcome = 'ordered') as ordered,
  count(*) filter (where outcome = 'sign_off') as sign_off,
  count(*) filter (where outcome = 'refused') as refused,
  count(*) filter (where outcome = 'asked') as asked,
  count(*) filter (where outcome = 'answered') as answered,
  count(*) filter (where input = 'spoken') as spoken,
  count(*) filter (where input = 'typed') as typed,
  round(avg(m.calls)::numeric, 1) as model_calls_per_turn,
  round(coalesce(sum(m.usd), 0)::numeric, 4) as model_usd
from t left join m using (turn_id) where started is not null`,
  },
  decidedBy: {
    title: "Orders by who decided",
    sql: series(r, `count(e.id) filter (where e.kind = 'gate.allowed') as agent_alone,
  count(e.id) filter (where e.kind = 'approval.granted') as person_approved,
  count(e.id) filter (where e.kind = 'approval.denied') as person_declined`, "('gate.allowed', 'approval.granted', 'approval.denied')"),
  },
  counters: {
    title: "Watch, offers and corrections",
    sql: `select kind, count(*) as n from telemetry.ops_events
where kind in ('ledger.watch', 'ledger.watch_answer', 'ledger.offer', 'ledger.offer_answer', 'turn.correction', 'turn.model_fallback', 'turn.grounding_refusal', 'turn.paused') and ts > ${r.since}
group by 1 order by 2 desc`,
  },
  crash: {
    title: "Crash-test scores",
    sql: `select ts, agent_id, value as score, run from telemetry.ops_events where kind = 'crashtest.score' order by ts desc`,
  },
  runs: {
    title: "Aiven Managed Agent runs",
    sql: `select ts, rule as preset, ok, value as seconds, detail from telemetry.ops_events where kind = 'aiven_agent.run' and ok is not null and ts > now() - interval '7 days' order by ts desc`,
  },
});

export type Panels = { catalogueSize?: number; at: string; range: Range; label: string; panels: Record<string, Panel>; modelToday: ReturnType<typeof dailyUsage>["llm"]; readAs: string; grafanaUrl?: string };

export async function panels(range: Range = "24h", catalogueSize?: number): Promise<Panels> {
  const r = RANGES[range] ?? RANGES["24h"];
  const q = QUERIES(r);
  // One at a time: the read-only user holds one connection.
  const out: Record<string, Panel> = {};
  let readAs = "dock_copilot";
  for (const [id, { title, sql }] of Object.entries(q)) {
    const res: QueryResult | QueryFailure = await readOnlyQuery(sql);
    if (res.ok) readAs = res.as;
    out[id] = { id, title, sql, rows: res.ok ? res.rows : [], error: res.ok ? undefined : res.reason, ms: res.ok ? res.ms : undefined };
  }
  const project = process.env.AIVEN_PROJECT?.trim();
  return { catalogueSize, at: new Date().toISOString(), range, label: r.label, panels: out, modelToday: dailyUsage().llm, readAs, grafanaUrl: project ? `https://dock-grafana-${project}.e.aivencloud.com/d/dock-overview` : undefined };
}
