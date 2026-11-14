import { readOnlyDbConfigured, readOnlyQuery } from "@/server/aiven/showcase/readonly-db";
import { auditSearchBody, auditSql, eventDoc, eventIndexer, parseAuditQuery, type AuditQuery } from "@/server/aiven/search/event-index";
import type { Runtime } from "@/server/runtime";
import { localEvents } from "./agent-watch";
import { opsContext } from "./context";

/**
 * Search the audit trail in words: OpenSearch's `dock-events` first (a deadline of 1.5 s), the same filters as SQL
 * over the read-only view as the fallback, and this server's own ledger when neither is configured. The answer
 * sentence is built by code from what came back; the query that ran is returned with it.
 */
export type AuditHit = { ts: string; kind: string; rule?: string; agentId?: string; agentLabel?: string; requestId?: string; orderId?: string; value?: number; ok?: boolean; outcome?: string };
export type AuditAnswer = {
  question: string;
  path: "opensearch" | "postgres" | "ledger";
  pathNote: string;
  read: { kinds: string[]; rules: string[]; who: string; when: string; text: string };
  query: string;
  total: number;
  hits: AuditHit[];
  byAgent: { key: string; label: string; n: number }[];
  byRule: { key: string; n: number }[];
  answer: string;
  ms: number;
};

const g = globalThis as typeof globalThis & { __dockAuditBackfill?: Promise<void> };

/** This server's ledger into the index once per process (ids are the ledger's positions, so a repeat writes nothing new). */
function backfill(rt: Runtime): Promise<void> {
  const ix = eventIndexer();
  if (!ix) return Promise.resolve();
  g.__dockAuditBackfill ??= (async () => {
    for (const e of localEvents(rt)) ix.add(e);
    await ix.flush();
  })().catch(() => undefined);
  return g.__dockAuditBackfill;
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`no answer within ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), ok(v)),
      (e) => (clearTimeout(t), fail(e)),
    );
  });
}

export async function auditSearch(rt: Runtime, question: string): Promise<AuditAnswer> {
  const t0 = performance.now();
  const now = new Date();
  const p = parseAuditQuery(question, now);
  const ctx = await opsContext(rt);
  const label = (id?: string) => (id ? (ctx.agents.get(id)?.label ?? id) : undefined);
  // Outside: an agent AimoPilot does not run, at the open door (MCP or REST), whatever kitchen it buys for.
  const viaDoor = new Set(ctx.door.all().filter((c) => c.via === "mcp" || c.via === "rest").map((c) => c.agentId));
  const isOutside = (a: { agentId: string; kind: string }) => a.kind === "outside" || viaDoor.has(a.agentId);
  const agentIds = p.who === "outside" ? [...ctx.agents.values()].filter(isOutside).map((a) => a.agentId) : p.who === "kitchen" ? [...ctx.agents.values()].filter((a) => !isOutside(a)).map((a) => a.agentId) : undefined;
  const read = {
    kinds: p.kinds,
    rules: p.ruleWords,
    who: p.who === "outside" ? `outside agents at the MCP or REST door (${agentIds?.length ?? 0})` : p.who === "kitchen" ? `kitchens' own agents (${agentIds?.length ?? 0})` : p.who ? p.who.agentId : "any agent",
    when: p.since.words,
    text: p.rest,
  };
  const finish = (path: AuditAnswer["path"], pathNote: string, query: string, total: number, hits: AuditHit[], byAgent: { key: string; n: number }[], byRule: { key: string; n: number }[]): AuditAnswer => {
    const what = p.kinds.length ? p.kinds.join(", ") : "events";
    const top = byAgent[0];
    const answer = total
      ? `${total} ${what}${p.ruleWords.length ? ` with ${p.ruleWords.join(" or ")} in the rule` : ""} by ${read.who} ${p.since.words}${top ? `; most by ${label(top.key) ?? top.key} (${top.n})` : ""}${byRule[0] ? `, most often ${byRule[0].key} (${byRule[0].n})` : ""}.`
      : `None: no ${what}${p.ruleWords.length ? ` with ${p.ruleWords.join(" or ")} in the rule` : ""} by ${read.who} ${p.since.words}.`;
    return { question, path, pathNote, read, query, total, hits: hits.map((h) => ({ ...h, agentLabel: label(h.agentId) })), byAgent: byAgent.map((a) => ({ ...a, label: label(a.key) ?? a.key })), byRule, answer, ms: Math.round(performance.now() - t0) };
  };

  const ix = eventIndexer();
  if (ix) {
    try {
      await withDeadline(backfill(rt), 3_000).catch(() => undefined);
      const body = auditSearchBody(p, agentIds);
      const res = await withDeadline(ix.client.search({ index: ix.index, body: body as never }), 1_500);
      const b = res.body as { hits?: { total?: { value?: number }; hits?: { _source?: Record<string, unknown> }[] }; aggregations?: Record<string, { buckets?: { key: string; doc_count: number }[] }> };
      const hits = (b.hits?.hits ?? []).map((h) => {
        const s = h._source ?? {};
        return { ts: String(s.ts), kind: String(s.kind), ...(s.rule ? { rule: String(s.rule) } : {}), ...(s.agent_id ? { agentId: String(s.agent_id) } : {}), ...(s.request_id ? { requestId: String(s.request_id) } : {}), ...(s.order_id ? { orderId: String(s.order_id) } : {}), ...(typeof s.value === "number" ? { value: s.value } : {}), ...(typeof s.ok === "boolean" ? { ok: s.ok } : {}), ...(s.outcome ? { outcome: String(s.outcome) } : {}) };
      });
      const agg = (k: string) => (b.aggregations?.[k]?.buckets ?? []).map((x) => ({ key: String(x.key), n: x.doc_count }));
      return finish("opensearch", `OpenSearch index ${ix.index} (${ix.stats().indexed} events written by this server).`, JSON.stringify(body, null, 2), b.hits?.total?.value ?? hits.length, hits, agg("by_agent"), agg("by_rule"));
    } catch (err) {
      if (!readOnlyDbConfigured()) return fromLedger(`OpenSearch did not answer (${(err as Error).message?.slice(0, 100)}): this server's ledger instead.`);
      return fromSql(`OpenSearch did not answer (${(err as Error).message?.slice(0, 100)}): PostgreSQL instead.`);
    }
  }
  if (readOnlyDbConfigured()) return fromSql("OpenSearch is not configured here: PostgreSQL's telemetry.");
  return fromLedger("Neither OpenSearch nor the read-only database user is configured here: this server's ledger.");

  async function fromSql(note: string): Promise<AuditAnswer> {
    const sql = auditSql(p, !!agentIds);
    const r = await readOnlyQuery(sql, agentIds ? [agentIds] : [], { maxRows: 500 });
    if (!r.ok) return fromLedger(`${note} It failed too (${r.reason.slice(0, 100)}): this server's ledger.`);
    const rows = r.rows;
    const count = (k: string) => {
      const m = new Map<string, number>();
      for (const x of rows) if (x[k]) m.set(String(x[k]), (m.get(String(x[k])) ?? 0) + 1);
      return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n).slice(0, 10);
    };
    const hits = rows.slice(0, 50).map((x) => ({ ts: String(x.ts), kind: String(x.kind), ...(x.rule ? { rule: String(x.rule) } : {}), ...(x.agent_id ? { agentId: String(x.agent_id) } : {}), ...(x.request_id ? { requestId: String(x.request_id) } : {}), ...(x.order_id ? { orderId: String(x.order_id) } : {}), ...(typeof x.value === "number" ? { value: x.value } : {}), ...(typeof x.ok === "boolean" ? { ok: x.ok } : {}), ...(x.outcome ? { outcome: String(x.outcome) } : {}) }));
    return finish("postgres", `${note} Read as ${r.as}.`, sql, rows.length + (r.truncated ? 1 : 0), hits, count("agent_id"), count("rule"));
  }

  function fromLedger(note: string): AuditAnswer {
    const since = new Date(p.since.iso).getTime();
    const ids = agentIds ? new Set(agentIds) : undefined;
    const docs = localEvents(rt)
      .map((e) => ({ e, d: eventDoc(e) }))
      .filter((x): x is { e: (typeof x)["e"]; d: NonNullable<(typeof x)["d"]> } => !!x.d)
      .filter(({ d }) => new Date(d.ts).getTime() > since && (!p.kinds.length || p.kinds.includes(d.kind)) && (!p.ruleWords.length || p.ruleWords.some((w) => d.rule?.includes(w))) && (!p.who || typeof p.who !== "object" || d.agent_id === p.who.agentId) && (!ids || (d.agent_id && ids.has(d.agent_id))))
      .sort((a, b) => b.d.ts.localeCompare(a.d.ts));
    const count = (k: "agent_id" | "rule") => {
      const m = new Map<string, number>();
      for (const { d } of docs) if (d[k]) m.set(d[k]!, (m.get(d[k]!) ?? 0) + 1);
      return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n).slice(0, 10);
    };
    return finish("ledger", note, auditSql(p, !!agentIds), docs.length, docs.slice(0, 50).map(({ d }) => ({ ts: d.ts, kind: d.kind, ...(d.rule ? { rule: d.rule } : {}), ...(d.agent_id ? { agentId: d.agent_id } : {}), ...(d.request_id ? { requestId: d.request_id } : {}), ...(d.order_id ? { orderId: d.order_id } : {}), ...(d.value !== undefined ? { value: d.value } : {}), ...(d.ok !== undefined ? { ok: d.ok } : {}), ...(d.outcome ? { outcome: d.outcome } : {}) })), count("agent_id"), count("rule"));
  }
}

export type { AuditQuery };
