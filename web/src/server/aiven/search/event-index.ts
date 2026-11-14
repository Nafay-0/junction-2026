import { Client } from "@opensearch-project/opensearch";
import type { ActionEvent } from "../actions";

/**
 * The audit trail on OpenSearch: every agent and gate event as a small document (codes, counts, durations, ids; no
 * buyer text, no product names, no addresses), so staff can search it in words from the operations portal
 * ("refusals for allergens by outside agents today"). The words are read by plain code into filters (kind, rule,
 * who, when, how) and a text match over the codes; the same filters run as SQL over the read-only view when
 * OpenSearch is not there. Index `dock-events` (DOCK_EVENTS_INDEX), one shard, written in batches every 2 s.
 */

export const EVENTS_INDEX = "dock-events";

export const eventsIndexBody = {
  settings: { number_of_shards: 1, number_of_replicas: 0, refresh_interval: "2s" },
  mappings: {
    dynamic: "strict",
    properties: {
      ts: { type: "date" },
      kind: { type: "keyword" },
      group: { type: "keyword" },
      rule: { type: "keyword" },
      agent_id: { type: "keyword" },
      org_id: { type: "keyword" },
      request_id: { type: "keyword" },
      order_id: { type: "keyword" },
      turn_id: { type: "keyword" },
      value: { type: "double" },
      ok: { type: "boolean" },
      ms: { type: "double" },
      cost_usd: { type: "double" },
      outcome: { type: "keyword" },
      door: { type: "keyword" },
      lang: { type: "keyword" },
      backend: { type: "keyword" },
      fallback: { type: "boolean" },
      /** The codes as words ("gate refused allergens"), for the text match. */
      words: { type: "text", analyzer: "english" },
    },
  },
} as const;

export type EventDoc = {
  ts: string;
  kind: string;
  group: string;
  rule?: string;
  agent_id?: string;
  org_id?: string;
  request_id?: string;
  order_id?: string;
  turn_id?: string;
  value?: number;
  ok?: boolean;
  ms?: number;
  cost_usd?: number;
  outcome?: string;
  door?: string;
  lang?: string;
  backend?: string;
  fallback?: boolean;
  words: string;
};

/** Kinds worth searching (the stream also carries partner-API and metric rows, which are not the audit trail). */
const KEEP = /^(request\.|gate\.|approval\.|order\.|quote\.|lookup\.|turn\.|search\.done|agent\.model|budget\.refused)/;

const WORDS: Record<string, string> = {
  "gate.refused": "gate refused refusal blocked",
  "gate.escalated": "gate escalated sign-off person approval needed",
  "gate.allowed": "gate allowed alone autonomous",
  "approval.requested": "sign-off approval asked requested",
  "approval.granted": "sign-off approval granted approved",
  "approval.denied": "sign-off approval denied declined",
  "order.committed": "order committed placed",
  "quote.issued": "quote price offer",
  "request.opened": "request opened",
  "turn.correction": "correction corrected changed buyer",
  "turn.done": "turn conversation done",
  "turn.started": "turn conversation started",
  "turn.model_fallback": "model fallback slow",
  "search.done": "search product",
  "agent.model": "model call",
};

/** One event as a search document, or undefined when it is not part of the audit trail. Only codes and numbers. */
export function eventDoc(e: ActionEvent): EventDoc | undefined {
  if (!KEEP.test(e.kind)) return undefined;
  const a = (e.attrs ?? {}) as Record<string, unknown>;
  const f = (a.facts ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length <= 80 ? v : undefined);
  const numv = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const rule = e.rule && e.rule.length <= 80 ? e.rule : undefined;
  const doc: EventDoc = {
    ts: e.at,
    kind: e.kind,
    group: e.kind.split(".")[0],
    ...(rule ? { rule } : {}),
    ...(e.agentId ? { agent_id: e.agentId } : {}),
    ...(e.orgId ? { org_id: e.orgId } : {}),
    ...(e.requestId ? { request_id: e.requestId } : {}),
    ...(e.orderId ? { order_id: e.orderId } : {}),
    ...(str(a.turnId) ? { turn_id: str(a.turnId) } : {}),
    ...(numv(e.value) !== undefined ? { value: e.value } : {}),
    ...(typeof e.ok === "boolean" ? { ok: e.ok } : {}),
    ...(numv(f.total_ms) !== undefined ? { ms: numv(f.total_ms) } : e.kind === "agent.model" && numv(e.value) !== undefined ? { ms: e.value } : {}),
    ...(numv(a.costUsd) ?? numv(f.cost_usd) ? { cost_usd: numv(a.costUsd) ?? numv(f.cost_usd) } : {}),
    ...(str(f.outcome) ?? str(a.outcome) ? { outcome: str(f.outcome) ?? str(a.outcome) } : {}),
    ...(str(f.door) ? { door: str(f.door) } : {}),
    ...(str(f.lang) ? { lang: str(f.lang) } : {}),
    ...(str(f.backend) ? { backend: str(f.backend) } : {}),
    ...(typeof f.fallback === "boolean" ? { fallback: f.fallback } : {}),
    words: [WORDS[e.kind] ?? e.kind.replace(/[._]/g, " "), rule?.replace(/_/g, " "), str(f.outcome)?.replace(/_/g, " "), str(f.edit)].filter(Boolean).join(" "),
  };
  return doc;
}

// ---------- reading the words ----------

export type AuditQuery = {
  text: string;
  kinds: string[];
  /** Rules named (or a word inside a rule id: "allergen" -> any rule with allergen in it). */
  ruleWords: string[];
  /** "outside agents", "kitchen agents", or one agent id named. */
  who?: "outside" | "kitchen" | { agentId: string };
  since: { sql: string; iso: string; words: string };
  /** Words left over after the filters: matched against the codes as text. */
  rest: string;
};

const KIND_WORDS: [RegExp, string[]][] = [
  [/refus|reject|block|denied by the gate|turned away/, ["gate.refused"]],
  [/escalat|sign.?off|approval|needed a person|to a person/, ["gate.escalated", "approval.requested", "approval.granted", "approval.denied"]],
  [/\b(alone|allowed|autonom)/, ["gate.allowed"]],
  [/\border(s|ed)?\b|commit/, ["order.committed"]],
  [/correct|changed/, ["turn.correction"]],
  [/search/, ["search.done"]],
  [/turn|conversation/, ["turn.started", "turn.done"]],
  [/quote/, ["quote.issued"]],
];

/** Words of rule ids a person might use (allergens, limit, budget, substitutes, quote, mandate, suspended). */
const RULE_WORDS = ["allergen", "limit", "budget", "substitut", "quote", "mandate", "suspen", "category", "delivery", "cutoff", "price", "attribute", "licence", "signature", "replay", "approver"];

export function parseAuditQuery(input: string, now: Date): AuditQuery {
  const q = input.toLowerCase().slice(0, 200);
  const kinds = [...new Set(KIND_WORDS.filter(([re]) => re.test(q)).flatMap(([, k]) => k))];
  const ruleWords = RULE_WORDS.filter((w) => q.includes(w));
  const idm = /\b(agent_[a-z0-9_]+)\b/.exec(q);
  const who: AuditQuery["who"] = idm ? { agentId: idm[1] } : /outside|external|mcp|rest\b|third.?party/.test(q) ? "outside" : /kitchen('s)? (own )?agent|kitchen agents/.test(q) ? "kitchen" : undefined;
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since =
    /last hour|past hour|this hour/.test(q)
      ? { sql: "now() - interval '1 hour'", iso: new Date(now.getTime() - 3_600_000).toISOString(), words: "in the last hour" }
      : /today/.test(q)
        ? { sql: "date_trunc('day', now())", iso: day.toISOString(), words: "today (UTC)" }
        : /yesterday/.test(q)
          ? { sql: "date_trunc('day', now()) - interval '1 day'", iso: new Date(day.getTime() - 86_400_000).toISOString(), words: "since yesterday (UTC)" }
          : { sql: "now() - interval '7 days'", iso: new Date(now.getTime() - 7 * 86_400_000).toISOString(), words: "in the last 7 days" };
  const used = /\b(?:refus\w*|reject\w*|block\w*|escalat\w*|sign.?offs?|approvals?|alone|allowed|orders?|commit\w*|correct\w*|changed|search\w*|turns?|conversations?|quotes?|outside|external|agents?|kitchens?|today|yesterday|last|past|this|hour|by|for|the|of|in|from|with|and|which|what|show|me|all|any|agent_[a-z0-9_]+)\b/g;
  const rest = q
    .replace(used, " ")
    .replace(/[^a-z0-9_ ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !RULE_WORDS.some((r) => w.startsWith(r)))
    .join(" ");
  return { text: input, kinds, ruleWords, ...(who ? { who } : {}), since, rest };
}

/** The OpenSearch query for the parsed words; `agentIds` resolves "outside agents" / "kitchen agents" to ids. */
export function auditSearchBody(p: AuditQuery, agentIds: string[] | undefined, size = 50): Record<string, unknown> {
  const filter: unknown[] = [{ range: { ts: { gte: p.since.iso } } }];
  if (p.kinds.length) filter.push({ terms: { kind: p.kinds } });
  if (p.ruleWords.length) filter.push({ bool: { should: p.ruleWords.map((w) => ({ wildcard: { rule: `*${w}*` } })), minimum_should_match: 1 } });
  if (p.who && typeof p.who === "object") filter.push({ term: { agent_id: p.who.agentId } });
  else if (agentIds) filter.push(agentIds.length ? { terms: { agent_id: agentIds } } : { match_none: {} });
  const must = p.rest ? [{ match: { words: { query: p.rest, operator: "or" } } }] : [];
  return {
    size,
    track_total_hits: true,
    query: { bool: { filter, must } },
    sort: [{ ts: "desc" }],
    aggs: { by_agent: { terms: { field: "agent_id", size: 10 } }, by_rule: { terms: { field: "rule", size: 10 } }, by_kind: { terms: { field: "kind", size: 10 } } },
    _source: ["ts", "kind", "rule", "agent_id", "org_id", "request_id", "order_id", "value", "ok", "outcome", "ms"],
  };
}

/** The same filters as SQL over the read-only view (the fallback). Parameters: $1 the agent id list, or null. */
export function auditSql(p: AuditQuery, withAgents: boolean): string {
  const where = [`ts > ${p.since.sql}`];
  if (p.kinds.length) where.push(`kind in (${p.kinds.map((k) => `'${k.replace(/'/g, "")}'`).join(", ")})`);
  if (p.ruleWords.length) where.push(`(${p.ruleWords.map((w) => `rule like '%${w.replace(/[^a-z]/g, "")}%'`).join(" or ")})`);
  if (p.who && typeof p.who === "object") where.push(`agent_id = '${p.who.agentId.replace(/[^a-z0-9_]/g, "")}'`);
  else if (withAgents) where.push("agent_id = any($1)");
  return `select ts, kind, rule, agent_id, org_id, request_id, order_id, value, ok, outcome
from telemetry.ops_events
where ${where.join("\n  and ")}
order by ts desc`;
}

// ---------- writing ----------

/** A ledger event's id is its ledger position and kind (the same however often the ledger is read); others keep theirs. */
export const eventDocId = (e: ActionEvent) => (e.ledgerSeq !== undefined ? `l${e.ledgerSeq}.${e.kind}` : e.eventId);

const g = globalThis as typeof globalThis & { __dockEventIndexer?: EventIndexer | null };

/** The process's indexer when OPENSEARCH_URL is set and DOCK_EVENTS_INDEX is not "off"; null otherwise (and under tests). */
export function eventIndexer(): EventIndexer | null {
  if (g.__dockEventIndexer !== undefined) return g.__dockEventIndexer;
  const url = (process.env.OPENSEARCH_URL ?? process.env.OPENSEARCH_URI)?.trim();
  const name = process.env.DOCK_EVENTS_INDEX?.trim();
  g.__dockEventIndexer = !url || name === "off" || process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build" ? null : new EventIndexer({ url }, name || EVENTS_INDEX);
  return g.__dockEventIndexer;
}

/** For tests. */
export function setEventIndexerForTests(i: EventIndexer | null | undefined): void {
  g.__dockEventIndexer = i;
}

type BulkClient = Pick<Client, "bulk" | "indices" | "search" | "count">;

/** Batches events into `dock-events`; creates the index on first use. Never throws into the caller. */
export class EventIndexer {
  private queue: EventDoc[] = [];
  private ids: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private ready: Promise<boolean> | null = null;
  indexed = 0;
  failed = 0;
  lastError?: string;
  readonly client: BulkClient;

  constructor(
    opts: { url?: string; client?: BulkClient },
    readonly index = EVENTS_INDEX,
  ) {
    this.client = opts.client ?? (new Client({ node: opts.url!, requestTimeout: 5_000, maxRetries: 0 }) as BulkClient);
  }

  ensureIndex(): Promise<boolean> {
    this.ready ??= (async () => {
      const exists = (await this.client.indices.exists({ index: this.index })).body;
      if (!exists) await this.client.indices.create({ index: this.index, body: eventsIndexBody as never }).catch((err) => {
        if (!/resource_already_exists/.test(String((err as { message?: string }).message))) throw err;
      });
      return true;
    })().catch((err) => {
      this.lastError = (err as Error).message?.slice(0, 160);
      this.ready = null;
      return false;
    });
    return this.ready;
  }

  add(e: ActionEvent): void {
    const doc = eventDoc(e);
    if (!doc) return;
    this.queue.push(doc);
    this.ids.push(eventDocId(e));
    if (this.queue.length > 5_000) {
      this.queue.splice(0, 1_000);
      this.ids.splice(0, 1_000);
    }
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 2_000);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (!this.queue.length || !(await this.ensureIndex())) return;
    const docs = this.queue.splice(0, 1_000);
    const ids = this.ids.splice(0, 1_000);
    try {
      const body = docs.flatMap((d, i) => [{ index: { _index: this.index, _id: ids[i] } }, d]);
      const res = await this.client.bulk({ body });
      const errs = res.body.errors ? (res.body.items as Array<Record<string, { error?: unknown }>>).filter((it) => Object.values(it)[0]?.error).length : 0;
      this.indexed += docs.length - errs;
      this.failed += errs;
    } catch (err) {
      this.failed += docs.length;
      this.lastError = (err as Error).message?.slice(0, 160);
    }
    if (this.queue.length) void this.flush();
  }

  stats() {
    return { index: this.index, indexed: this.indexed, failed: this.failed, pending: this.queue.length, ...(this.lastError ? { lastError: this.lastError } : {}) };
  }
}
