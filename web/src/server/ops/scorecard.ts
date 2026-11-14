import type { ActionEvent } from "@/server/aiven/actions";

/**
 * The agent scorecard: for every agent at the door (a kitchen's own agent, an outside agent over MCP or REST, a
 * crash-test model), what it did over a window and one status with its reason in words. Computed by plain code: the
 * figures are SQL over telemetry.events (as the read-only copilot user, the query shown beside them), or, without the
 * database, the same figures from this server's ledger and recent events; the status is decided here from the
 * figures and the thresholds below. Nothing here acts: it proposes, and a person decides through the existing
 * controls (suspend in Control, the trace, the kitchen's own rules).
 */

export type ScoreWindow = "1h" | "today" | "24h";
export const WINDOWS: Record<ScoreWindow, { sql: string; words: string; since: (now: Date) => Date }> = {
  "1h": { sql: "now() - interval '1 hour'", words: "the last hour", since: (n) => new Date(n.getTime() - 3_600_000) },
  today: { sql: "date_trunc('day', now())", words: "today (UTC)", since: (n) => new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) },
  "24h": { sql: "now() - interval '24 hours'", words: "the last 24 hours", since: (n) => new Date(n.getTime() - 86_400_000) },
};

/** A turn that started and has no end after this long failed or timed out (the engine's watchdog is 150 s). */
export const TURN_GIVE_UP_S = 150;

export type AgentFigures = {
  agentId: string;
  requests: number;
  /** Gate decisions: placed alone, sent to a person, refused. */
  alone: number;
  escalated: number;
  /** Escalations because the order was over what the agent may spend alone. */
  overLimit: number;
  refused: number;
  committed: number;
  granted: number;
  denied: number;
  /** Quotes the agent proposed (each an offer at a fixed price). */
  proposals: number;
  /** The buyer changed the agent's proposal (amount, product, day) on the order sheet. */
  corrections: number;
  turns: number;
  failedTurns: number;
  modelFallbacks: number;
  liveLookups: number;
  productsPriced: number;
  spendUsd: number;
  decideP50S: number | null;
  decideP90S: number | null;
  turnP50S: number | null;
  turnP90S: number | null;
  refusedRules: { rule: string; n: number }[];
  lastRefusedRequest: string | null;
  lastAt: string | null;
};

export type AgentStatus = "performing" | "escalating" | "failing" | "quiet";

/** The thresholds, in one table, each with its reason. A status needs both the share and the minimum count. */
export const AGENT_THRESHOLDS = [
  { id: "refusal_rate", status: "failing", limit: 0.3, min: 3, label: "Refused by the gate", unit: "of its gate decisions", why: "Refusals are the gate holding: one is the gate working, a third of everything an agent tries is an agent that does not understand its mandate or is trying to get round it." },
  { id: "failed_turns", status: "failing", limit: 0.2, min: 2, label: "Turns that failed or timed out", unit: `of its turns (no end within ${TURN_GIVE_UP_S} s)`, why: "The buyer was left without an answer; two in a window is a pattern, not a blip." },
  { id: "escalation_rate", status: "escalating", limit: 0.5, min: 2, label: "Sent to a person", unit: "of its gate decisions", why: "Half of its orders needing a person defeats the point of an agent; if most are over its spending limit and get approved, the mandate is too tight for what the kitchen asks of it." },
  { id: "over_limit", status: "escalating", limit: 2, min: 2, label: "Over-limit attempts", unit: "orders over what it may spend alone", why: "Repeatedly proposing orders above its own limit: a kitchen whose needs have grown past its mandate, or an agent that does not respect the limit." },
  { id: "decide_p90", status: "note", limit: 60, min: 3, label: "Time to a decision, 90th percentile", unit: "seconds from request to the gate's decision", why: "A minute is longer than a cook waits at a screen." },
  { id: "correction_rate", status: "note", limit: 0.5, min: 2, label: "Buyer corrections", unit: "per proposal", why: "The partner scores the least manual correction: a buyer changing every other proposal means the agent does not match what was asked." },
  { id: "live_per_order", status: "note", limit: 10, min: 3, label: "Live-price calls per order", unit: "calls to the partner's price API per committed order", why: "The partner asks that the price API is called only when needed; narrowing in master data first keeps this low." },
] as const;

export type ScoreRow = AgentFigures & {
  label: string;
  orgName: string;
  kind: string;
  suspended: boolean;
  status: AgentStatus;
  reason: string;
  notes: string[];
  rates: { escalation: number | null; refusal: number | null; correction: number | null };
  perOrder: { spendUsd: number | null; liveLookups: number | null };
  /** What a person might do, with the evidence. Never done automatically. */
  proposal?: { action: "suspend" | "trace" | "raise_mandate" | "lower_licence"; title: string; why: string; requestId?: string };
};

const share = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (x: number) => `${Math.round(x * 100)} %`;
const T = Object.fromEntries(AGENT_THRESHOLDS.map((t) => [t.id, t])) as Record<(typeof AGENT_THRESHOLDS)[number]["id"], (typeof AGENT_THRESHOLDS)[number]>;

/** One status per agent, with its reason in words, from the figures alone. */
export function judgeAgent(f: AgentFigures, info: { label: string; orgName: string; kind: string; suspended?: boolean }): ScoreRow {
  const decisions = f.alone + f.escalated + f.refused;
  const rates = { escalation: share(f.escalated, decisions), refusal: share(f.refused, decisions), correction: share(f.corrections, f.proposals) };
  const perOrder = { spendUsd: f.committed ? f.spendUsd / f.committed : null, liveLookups: f.committed ? f.liveLookups / f.committed : null };
  const notes: string[] = [];
  const base = { ...f, ...info, suspended: !!info.suspended, rates, perOrder, notes };
  const topRule = f.refusedRules[0];
  if (f.decideP90S !== null && decisions >= T.decide_p90.min && f.decideP90S > T.decide_p90.limit) notes.push(`slow: 90 % of its decisions within ${Math.round(f.decideP90S)} s`);
  if (rates.correction !== null && f.proposals >= T.correction_rate.min && rates.correction >= T.correction_rate.limit) notes.push(`the buyer corrected ${f.corrections} of ${f.proposals} proposals`);
  if (perOrder.liveLookups !== null && f.committed >= T.live_per_order.min && perOrder.liveLookups > T.live_per_order.limit) notes.push(`${perOrder.liveLookups.toFixed(1)} live-price calls per order`);
  if (f.modelFallbacks) notes.push(`${f.modelFallbacks} model fallback${f.modelFallbacks > 1 ? "s" : ""}`);

  if (!f.requests && !f.turns && !decisions) return { ...base, status: "quiet", reason: "Nothing at the door in this window." };

  const failingRefusals = rates.refusal !== null && f.refused >= T.refusal_rate.min && rates.refusal >= T.refusal_rate.limit;
  const failingTurns = f.failedTurns >= T.failed_turns.min && (share(f.failedTurns, f.turns) ?? 0) >= T.failed_turns.limit;
  if (failingRefusals || failingTurns) {
    const parts: string[] = [];
    if (failingRefusals) parts.push(`refused ${f.refused} of ${decisions} decisions (${pct(rates.refusal!)})${topRule ? `, ${topRule.n} of them by ${topRule.rule}` : ""}`);
    if (failingTurns) parts.push(`${f.failedTurns} of ${f.turns} turns failed or timed out`);
    const reason = `Failing: ${parts.join("; ")}.`;
    return {
      ...base,
      status: "failing",
      reason,
      proposal: info.suspended
        ? { action: "trace", title: "Open its last refused request", why: "Already suspended; the trace shows what it tried.", ...(f.lastRefusedRequest ? { requestId: f.lastRefusedRequest } : {}) }
        : { action: "suspend", title: "Suspend this agent", why: `${reason} A person decides; the suspension names who did it and why.`, ...(f.lastRefusedRequest ? { requestId: f.lastRefusedRequest } : {}) },
    };
  }
  const escalatingRate = rates.escalation !== null && f.escalated >= T.escalation_rate.min && rates.escalation >= T.escalation_rate.limit;
  const escalatingLimit = f.overLimit >= T.over_limit.min;
  if (escalatingRate || escalatingLimit) {
    const tight = f.overLimit > 0 && f.overLimit >= f.escalated / 2 && f.denied === 0 && f.granted >= Math.max(1, f.overLimit - 1);
    const reason = `Escalating: ${f.escalated} of ${decisions} decisions went to a person${f.overLimit ? `, ${f.overLimit} because the order was over what it may spend alone` : ""}${f.granted || f.denied ? `; ${f.granted} approved, ${f.denied} declined` : ""}.`;
    return {
      ...base,
      status: "escalating",
      reason: tight ? `${reason} Its mandate looks too tight for what the kitchen asks of it: a suggestion to the kitchen, not a fault.` : reason,
      proposal: tight
        ? { action: "raise_mandate", title: "Suggest a higher limit to the kitchen", why: "The people who sign off keep approving orders over its limit; the kitchen can raise it in Your rules." }
        : { action: "trace", title: "Open its latest request", why: "See why the gate sent it to a person." },
    };
  }
  return { ...base, status: "performing", reason: `Performing: ${f.alone} placed alone, ${f.escalated} sent to a person, ${f.refused} refused, within its thresholds.` };
}

// ---------- the figures from PostgreSQL ----------

/** The scorecard's figures per agent, as SQL over the read-only view (infra/copilot.sql). */
export function scorecardSql(window: ScoreWindow): string {
  const since = WINDOWS[window].sql;
  return `with e as (
  select ts, kind, rule, agent_id, request_id, value, products, cost_usd, turn_id, facts
  from telemetry.ops_events where ts > ${since} and agent_id is not null
),
k as (
  select agent_id,
    count(*) filter (where kind = 'request.opened') as requests,
    count(*) filter (where kind = 'gate.allowed') as alone,
    count(*) filter (where kind = 'gate.escalated') as escalated,
    count(*) filter (where kind = 'gate.escalated' and rule = 'per_order_limit') as over_limit,
    count(*) filter (where kind = 'gate.refused') as refused,
    count(*) filter (where kind = 'order.committed') as committed,
    count(*) filter (where kind = 'approval.granted') as granted,
    count(*) filter (where kind = 'approval.denied') as denied,
    count(*) filter (where kind = 'quote.issued') as proposals,
    count(*) filter (where kind = 'turn.correction') as corrections,
    count(*) filter (where kind = 'turn.model_fallback') as model_fallbacks,
    count(*) filter (where kind = 'lookup.live') as live_lookups,
    coalesce(sum(products) filter (where kind = 'lookup.live'), 0) as products_priced,
    round((coalesce(sum(cost_usd) filter (where kind = 'agent.model'), 0)
      + coalesce(sum((facts->>'cost_usd')::float8) filter (where kind = 'search.done'), 0))::numeric, 6) as spend_usd,
    max(ts) as last_at,
    (array_agg(request_id order by ts desc) filter (where kind = 'gate.refused' and request_id is not null))[1] as last_refused_request
  from e group by 1
),
d as (
  select agent_id,
    round(percentile_cont(0.5) within group (order by s)::numeric, 1) as decide_p50_s,
    round(percentile_cont(0.9) within group (order by s)::numeric, 1) as decide_p90_s
  from (select agent_id, request_id,
      extract(epoch from min(ts) filter (where kind in ('gate.allowed', 'gate.escalated', 'gate.refused')) - min(ts) filter (where kind = 'request.opened')) as s
    from e where request_id is not null group by 1, 2) x
  where s is not null group by 1
),
t as (
  select agent_id, count(*) as turns,
    count(*) filter (where done is null and started < now() - interval '${TURN_GIVE_UP_S} seconds') as failed_turns,
    round(percentile_cont(0.5) within group (order by extract(epoch from done - started))::numeric, 1) as turn_p50_s,
    round(percentile_cont(0.9) within group (order by extract(epoch from done - started))::numeric, 1) as turn_p90_s
  from (select agent_id, turn_id, min(ts) filter (where kind = 'turn.started') as started, min(ts) filter (where kind = 'turn.done') as done
    from e where turn_id is not null and kind in ('turn.started', 'turn.done') group by 1, 2) y
  where started is not null group by 1
),
r as (
  select agent_id, string_agg(rule || ':' || n, ',' order by n desc, rule) as refused_rules
  from (select agent_id, coalesce(rule, '(no rule named)') as rule, count(*) as n from e where kind = 'gate.refused' group by 1, 2) z
  group by 1
)
select k.*, coalesce(t.turns, 0) as turns, coalesce(t.failed_turns, 0) as failed_turns, d.decide_p50_s, d.decide_p90_s, t.turn_p50_s, t.turn_p90_s, r.refused_rules
from k left join d using (agent_id) left join t using (agent_id) left join r using (agent_id)
order by k.last_at desc`;
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const nn = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function figuresFromRow(r: Record<string, unknown>): AgentFigures {
  return {
    agentId: String(r.agent_id),
    requests: n(r.requests),
    alone: n(r.alone),
    escalated: n(r.escalated),
    overLimit: n(r.over_limit),
    refused: n(r.refused),
    committed: n(r.committed),
    granted: n(r.granted),
    denied: n(r.denied),
    proposals: n(r.proposals),
    corrections: n(r.corrections),
    turns: n(r.turns),
    failedTurns: n(r.failed_turns),
    modelFallbacks: n(r.model_fallbacks),
    liveLookups: n(r.live_lookups),
    productsPriced: n(r.products_priced),
    spendUsd: n(r.spend_usd),
    decideP50S: nn(r.decide_p50_s),
    decideP90S: nn(r.decide_p90_s),
    turnP50S: nn(r.turn_p50_s),
    turnP90S: nn(r.turn_p90_s),
    refusedRules: String(r.refused_rules ?? "")
      .split(",")
      .filter(Boolean)
      .map((x) => {
        const i = x.lastIndexOf(":");
        return { rule: x.slice(0, i), n: Number(x.slice(i + 1)) };
      }),
    lastRefusedRequest: r.last_refused_request ? String(r.last_refused_request) : null,
    lastAt: r.last_at instanceof Date ? r.last_at.toISOString() : r.last_at ? new Date(String(r.last_at)).toISOString() : null,
  };
}

// ---------- the same figures from events in memory ----------

/** Continuous percentile, as PostgreSQL's percentile_cont, rounded to 0.1. */
export function percentileCont(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = p * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const v = s[lo] + (s[hi] - s[lo]) * (pos - lo);
  return Math.round(v * 10) / 10;
}

type Ev = Pick<ActionEvent, "at" | "kind" | "rule" | "agentId" | "requestId" | "attrs"> & { value?: number };

/**
 * The scorecard's figures from action events (this server's ledger mapped by LedgerToActions, plus the model and
 * search events it saw): the same definitions as scorecardSql, for a server without the database.
 */
export function figuresFromEvents(events: readonly Ev[], since: Date, now: Date): AgentFigures[] {
  const from = since.getTime();
  const by = new Map<string, Ev[]>();
  for (const e of events) {
    if (!e.agentId || new Date(e.at).getTime() <= from) continue;
    const l = by.get(e.agentId) ?? [];
    l.push(e);
    by.set(e.agentId, l);
  }
  const out: AgentFigures[] = [];
  for (const [agentId, es] of by) {
    const c = (k: string, f: (e: Ev) => boolean = () => true) => es.filter((e) => e.kind === k && f(e)).length;
    const attr = (e: Ev, k: string) => (e.attrs as Record<string, unknown> | undefined)?.[k];
    const fact = (e: Ev, k: string) => ((attr(e, "facts") ?? {}) as Record<string, unknown>)[k];
    const spend =
      es.filter((e) => e.kind === "agent.model" || (e.kind === "ledger.agent" && attr(e, "event") === "model_call")).reduce((a, e) => a + n(attr(e, "costUsd")), 0) +
      es.filter((e) => e.kind === "search.done").reduce((a, e) => a + n(fact(e, "cost_usd")), 0);
    // Model calls appear once as agent.model (the stream) or once as the ledger's copy: count whichever this source has.
    const hasStreamModel = es.some((e) => e.kind === "agent.model");
    const spendOnce = hasStreamModel ? spend - es.filter((e) => e.kind === "ledger.agent" && attr(e, "event") === "model_call").reduce((a, e) => a + n(attr(e, "costUsd")), 0) : spend;
    const reqs = new Map<string, { opened?: number; decided?: number }>();
    for (const e of es) {
      if (!e.requestId) continue;
      const r = reqs.get(e.requestId) ?? {};
      const t = new Date(e.at).getTime();
      if (e.kind === "request.opened") r.opened = Math.min(r.opened ?? t, t);
      if (e.kind === "gate.allowed" || e.kind === "gate.escalated" || e.kind === "gate.refused") r.decided = Math.min(r.decided ?? t, t);
      reqs.set(e.requestId, r);
    }
    const decide = [...reqs.values()].filter((r) => r.opened !== undefined && r.decided !== undefined).map((r) => (r.decided! - r.opened!) / 1000);
    const turns = new Map<string, { started?: number; done?: number }>();
    for (const e of es) {
      const id = attr(e, "turnId");
      if (typeof id !== "string" || (e.kind !== "turn.started" && e.kind !== "turn.done")) continue;
      const t = turns.get(id) ?? {};
      const at = new Date(e.at).getTime();
      if (e.kind === "turn.started") t.started = Math.min(t.started ?? at, at);
      else t.done = Math.min(t.done ?? at, at);
      turns.set(id, t);
    }
    const started = [...turns.values()].filter((t) => t.started !== undefined);
    const lengths = started.filter((t) => t.done !== undefined).map((t) => (t.done! - t.started!) / 1000);
    const rules = new Map<string, number>();
    for (const e of es) if (e.kind === "gate.refused") rules.set(e.rule ?? "(no rule named)", (rules.get(e.rule ?? "(no rule named)") ?? 0) + 1);
    const refusedSorted = es.filter((e) => e.kind === "gate.refused" && e.requestId).sort((a, b) => b.at.localeCompare(a.at));
    out.push({
      agentId,
      requests: c("request.opened"),
      alone: c("gate.allowed"),
      escalated: c("gate.escalated"),
      overLimit: c("gate.escalated", (e) => e.rule === "per_order_limit"),
      refused: c("gate.refused"),
      committed: c("order.committed"),
      granted: c("approval.granted"),
      denied: c("approval.denied"),
      proposals: c("quote.issued"),
      corrections: c("turn.correction"),
      turns: started.length,
      failedTurns: started.filter((t) => t.done === undefined && t.started! < now.getTime() - TURN_GIVE_UP_S * 1000).length,
      modelFallbacks: c("turn.model_fallback"),
      liveLookups: c("lookup.live"),
      productsPriced: es.filter((e) => e.kind === "lookup.live").reduce((a, e) => a + n(attr(e, "products")), 0),
      spendUsd: Math.round(spendOnce * 1e6) / 1e6,
      decideP50S: percentileCont(decide, 0.5),
      decideP90S: percentileCont(decide, 0.9),
      turnP50S: percentileCont(lengths, 0.5),
      turnP90S: percentileCont(lengths, 0.9),
      refusedRules: [...rules.entries()].map(([rule, k]) => ({ rule, n: k })).sort((a, b) => b.n - a.n || a.rule.localeCompare(b.rule)),
      lastRefusedRequest: refusedSorted[0]?.requestId ?? null,
      lastAt: es.map((e) => e.at).sort().at(-1) ?? null,
    });
  }
  return out.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}
