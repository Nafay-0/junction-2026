import { randomUUID } from "node:crypto";
import type { LedgerEntry, LedgerStore } from "@/core/ledger";

/**
 * The action stream: one event per agent action and gate decision, derived from the ledger as it is written
 * (so nothing in the core has to remember to emit it), plus partner-API cache events from the live cache.
 *
 * Schema (version 1), JSON, one Kafka message per event on topic `dock.actions`, keyed by
 * `orderId ?? requestId ?? agentId ?? "dock"` so everything about one order stays in order on one partition:
 *
 *   v          1
 *   eventId    uuid, unique; the sink writes each id once (telemetry.events attrs.event_id)
 *   at         ISO time of the action
 *   source     "dock-app"
 *   kind       request.opened | intake.step | lookup.search | lookup.live | quote.issued
 *              | gate.allowed | gate.escalated | gate.refused | approval.requested | approval.granted
 *              | approval.denied | order.committed | partner_api.call | partner_api.cache_hit | budget.refused
 *              | turn.started | turn.done | turn.failed | turn.correction | turn.model_fallback | turn.grounding_refusal | turn.paused
 *              | search.done (smart search, server/search/telemetry.ts)
 *   facts      (attrs.facts) counts, codes and milliseconds of a conversation turn or a search: never words
 *   key        the partition key above
 *   agentId, orgId, requestId, orderId   when known
 *   rule       the gate rule that decided (gate.refused, gate.escalated, budget.refused)
 *   value      EUR for quote.issued / order.committed / gate.*, milliseconds for partner_api.call
 *   ok         false for refusals
 *   ledgerSeq, ledgerHash   the ledger entry the event came from (audit cross-reference)
 *   summary    the ledger's one plain-language sentence
 *   attrs      small extra detail (rule outcomes, product count, error code)
 *
 * The same row lands in telemetry.events (kind, rule, agent_id, order_id, value, ok, attrs incl. event_id),
 * which is what the Grafana dashboard reads.
 */
export type ActionEvent = {
  v: 1;
  eventId: string;
  at: string;
  source: "dock-app";
  kind: string;
  key: string;
  agentId?: string;
  orgId?: string;
  requestId?: string;
  orderId?: string;
  rule?: string;
  value?: number;
  ok?: boolean;
  ledgerSeq?: number;
  ledgerHash?: string;
  summary?: string;
  attrs?: Record<string, unknown>;
};

export type ActionInput = Omit<ActionEvent, "v" | "eventId" | "at" | "source" | "key"> & { at?: string };

/** Where action events go. `emit` never blocks and never throws: the gate must not wait on telemetry. */
export interface ActionStream {
  emit(event: ActionEvent): void;
  /** Wait (bounded) until everything emitted so far is handed off. */
  flush(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
  stats(): Record<string, number | string | boolean>;
  /** The id of the last event handed off, so shutdown can wait for it to reach the table. */
  lastEventId?(): string | undefined;
}

export function actionEvent(input: ActionInput): ActionEvent {
  const { at, ...rest } = input;
  return {
    v: 1,
    eventId: randomUUID(),
    at: at ?? new Date().toISOString(),
    source: "dock-app",
    key: input.orderId ?? input.requestId ?? input.agentId ?? "dock",
    ...rest,
  };
}

export const noActions: ActionStream = {
  emit: () => undefined,
  flush: async () => undefined,
  close: async () => undefined,
  stats: () => ({ kind: "off" }),
};

const cents = (v: unknown) => (typeof v === "number" ? Math.round(v) / 100 : undefined);
const agentOf = (actor: string) => (actor.startsWith("agent:") ? actor.slice(6) : undefined);
type RuleRow = { rule?: string; outcome?: string };

/**
 * Turns ledger entries into action events. Keeps a little state (who opened which request, the total of each
 * order's decision) so decisions and commits written by "dock" are still attributed to the agent and carry EUR.
 */
/** The language of a buyer's words, by plain signs only (letters and common words): fi, sv, en, or "other". */
export function languageOf(words: string): "fi" | "sv" | "en" | "other" {
  const s = ` ${words.toLowerCase()} `;
  if (!/[a-zåäö]/.test(s)) return "other";
  const fi = (s.match(/ (ja|on|ei|tarvi\w*|kiitos|meille|huomenna|maitoa|kpl|litraa|tilaa|että|kanssa|ilman)\b|ää|öö|yy/g) ?? []).length;
  const sv = (s.match(/å| (och|är|inte|behöver|tack|till|mjölk|imorgon|utan|med)\b/g) ?? []).length;
  const en = (s.match(/ (the|and|need|please|for|of|milk|tomorrow|without|with|litres?|we)\b/g) ?? []).length;
  const best = Math.max(fi, sv, en);
  if (!best) return /[äö]/.test(s) ? "fi" : "other";
  return fi === best ? "fi" : sv === best ? "sv" : "en";
}

/** Conversation events in the ledger (type agent, data.event) that become their own telemetry kinds. */
const TURN_KINDS: Record<string, string> = {
  turn: "turn.started",
  turn_done: "turn.done",
  turn_failed: "turn.failed",
  sheet_edit: "turn.correction",
  model_fallback: "turn.model_fallback",
  grounding_refusal: "turn.grounding_refusal",
  paused: "turn.paused",
};

export class LedgerToActions {
  private readonly agentByRequest = new Map<string, string>();
  private readonly totalByOrder = new Map<string, number>();
  /** The gate's last word per request (allowed, escalated, refused and its rule), for a turn's outcome. */
  private readonly gateByRequest = new Map<string, { kind: string; rule?: string }>();

  /** Learn from entries that were written before this process started (no events are produced). */
  prime(entries: readonly LedgerEntry[]): void {
    for (const e of entries) this.learn(e);
  }

  private learn(e: LedgerEntry): void {
    const agent = agentOf(e.actor);
    if (agent && e.requestId && !this.agentByRequest.has(e.requestId)) {
      this.agentByRequest.set(e.requestId, agent);
      if (this.agentByRequest.size > 20_000) this.agentByRequest.delete(this.agentByRequest.keys().next().value!);
    }
    if (e.type === "decision" && e.requestId) {
      const outcome = String(e.data.outcome);
      const rules = Array.isArray(e.data.rules) ? (e.data.rules as RuleRow[]) : [];
      const kind = outcome === "auto_approve" ? "allowed" : outcome === "needs_human_approval" ? "escalated" : "refused";
      const rule = kind === "refused" ? rules.find((r) => r.outcome === "fail")?.rule : kind === "escalated" ? rules.find((r) => r.outcome && r.outcome !== "pass" && r.outcome !== "fail")?.rule : undefined;
      this.gateByRequest.set(e.requestId, { kind, ...(rule ? { rule } : {}) });
      if (this.gateByRequest.size > 20_000) this.gateByRequest.delete(this.gateByRequest.keys().next().value!);
    }
    if (e.type === "decision" && e.orderId && typeof e.data.totalCents === "number") {
      this.totalByOrder.set(e.orderId, e.data.totalCents);
      if (this.totalByOrder.size > 20_000) this.totalByOrder.delete(this.totalByOrder.keys().next().value!);
    }
  }

  /** Counts, codes and milliseconds of a turn event (never the words). */
  private turnFacts(kind: string, d: Record<string, unknown>, door: string | undefined): Record<string, unknown> {
    if (kind === "turn.started") {
      const words = typeof d.words === "string" ? d.words : "";
      return { door: door ?? null, via: typeof d.via === "string" ? d.via : null, input: d.action ? "tap" : words ? (door === "voice" || door === "call" ? "spoken" : "typed") : "other", lang: words ? languageOf(words) : null };
    }
    if (kind === "turn.done") {
      const marks = (d.marks ?? {}) as Record<string, unknown>;
      const requests = Array.isArray(d.requests) ? (d.requests as string[]) : [];
      const orders = Array.isArray(d.orders) ? d.orders.length : 0;
      const gates = requests.map((r) => this.gateByRequest.get(r)).filter(Boolean) as { kind: string; rule?: string }[];
      const refused = gates.find((g) => g.kind === "refused");
      const status = String(d.status ?? "done");
      // The engine's own outcome code when it wrote one (thread/outcome.ts), else read from the gate's decisions.
      const inferred = refused ? "refused" : status === "waiting_approver" || gates.some((g) => g.kind === "escalated") ? "sent_for_signoff" : orders > 0 || gates.some((g) => g.kind === "allowed") ? "ordered" : status === "waiting_buyer" ? "asked" : status === "failed" ? "failed" : "answered";
      const outcome = typeof d.outcome === "string" ? d.outcome : inferred;
      const rule = typeof d.rule === "string" ? d.rule : refused?.rule;
      return {
        status,
        outcome,
        ...(rule ? { rule } : {}),
        first_ms: num(marks.line) ?? num(marks.first_step),
        end_ms: num(marks.done),
        requests: requests.length,
        orders,
        cards: Array.isArray(d.cards) ? (d.cards as unknown[]).filter((c) => typeof c === "string").slice(0, 12) : [],
      };
    }
    if (kind === "turn.failed") return { code: typeof d.code === "string" ? d.code : "engine_error", ms: num(d.ms) };
    if (kind === "turn.correction") return { edit: (d.edit as { kind?: string } | undefined)?.kind ?? null, verified: d.verified === true };
    return {};
  }

  toEvent(e: LedgerEntry): ActionEvent | undefined {
    this.learn(e);
    const d = e.data;
    const base: ActionInput = {
      kind: "",
      at: e.at,
      agentId: agentOf(e.actor) ?? (e.requestId ? this.agentByRequest.get(e.requestId) : undefined),
      requestId: e.requestId,
      orderId: e.orderId,
      ledgerSeq: e.seq,
      ledgerHash: e.hash,
      summary: e.summary.slice(0, 400),
    };
    const rules = Array.isArray(d.rules) ? (d.rules as RuleRow[]) : [];
    switch (e.type) {
      case "request":
        return actionEvent({ ...base, kind: "request.opened" });
      case "intake":
        return actionEvent({ ...base, kind: "intake.step", attrs: pick(d, ["step", "state", "event"]) });
      case "lookup":
        return actionEvent({
          ...base,
          kind: d.source === "live" ? "lookup.live" : "lookup.search",
          ok: d.failed === true ? false : undefined, // the wholesaler's live service did not answer
          attrs: { products: Array.isArray(d.productIds) ? d.productIds.length : Array.isArray(d.resultIds) ? d.resultIds.length : undefined, failed: d.failed === true || undefined, code: typeof d.code === "string" ? d.code : undefined },
        });
      case "quote":
        return actionEvent({ ...base, kind: "quote.issued", value: cents(d.totalCents), attrs: pick(d, ["quoteId", "expiresAt"]) });
      case "decision": {
        const outcome = String(d.outcome);
        const failed = rules.find((r) => r.outcome === "fail");
        const escalated = rules.find((r) => r.outcome && r.outcome !== "pass" && r.outcome !== "fail");
        const kind = outcome === "auto_approve" ? "gate.allowed" : outcome === "needs_human_approval" ? "gate.escalated" : "gate.refused";
        return actionEvent({
          ...base,
          kind,
          rule: kind === "gate.refused" ? failed?.rule : kind === "gate.escalated" ? escalated?.rule : undefined,
          value: cents(d.totalCents),
          ok: kind !== "gate.refused",
          attrs: { outcome, rules: rules.map((r) => `${r.rule}:${r.outcome}`) },
        });
      }
      case "approval_requested":
        return actionEvent({ ...base, kind: "approval.requested", rule: typeof d.role === "string" ? d.role : undefined });
      case "approval": {
        const granted = d.decision === "approved";
        const signOff = (d.signOff ?? {}) as { method?: string; verified?: boolean };
        return actionEvent({ ...base, kind: granted ? "approval.granted" : "approval.denied", ok: granted, attrs: { method: signOff.method, verified: signOff.verified } });
      }
      case "order":
        return actionEvent({ ...base, kind: "order.committed", value: e.orderId ? cents(this.totalByOrder.get(e.orderId)) : undefined, ok: true, attrs: pick(d, []) });
      case "agent": {
        const ev = typeof d.event === "string" ? d.event : "";
        const thread = (d.thread ?? {}) as { threadId?: string; turnId?: string; door?: string };
        const tag = { ...(thread.turnId ? { turnId: thread.turnId } : {}), ...(thread.threadId ? { threadId: thread.threadId } : {}) };
        const kind = TURN_KINDS[ev];
        if (!kind) {
          // Model and tool calls are already their own events (agent.model / agent.tool, thread/telemetry.ts); the
          // ledger copy keeps its old kind, with the cost for the in-process scorecard and no words.
          return actionEvent({ ...base, kind: "ledger.agent", attrs: { event: ev || undefined, ...tag, ...(ev === "model_call" && typeof d.costUsd === "number" ? { costUsd: d.costUsd } : {}) } });
        }
        return actionEvent({ ...base, kind, summary: turnSummary(kind, d), ok: kind === "turn.done" ? true : kind === "turn.started" || kind === "turn.correction" ? undefined : false, attrs: { ...tag, facts: this.turnFacts(kind, d, thread.door) } });
      }
      case "refusal":
        return actionEvent({ ...base, kind: "gate.refused", rule: typeof d.rule === "string" ? d.rule : typeof d.code === "string" ? d.code : undefined, ok: false, attrs: pick(d, ["code", "status"]) });
      default:
        return actionEvent({ ...base, kind: `ledger.${String(e.type)}` });
    }
  }
}

/** One plain sentence per turn event, with no words of the buyer in it (the ledger's own summary may quote them). */
function turnSummary(kind: string, d: Record<string, unknown>): string {
  switch (kind) {
    case "turn.started":
      return "The buyer spoke or tapped; the agent's turn started.";
    case "turn.done":
      return `The agent's turn finished (${String(d.status ?? "done")}).`;
    case "turn.failed":
      return `The agent's turn failed (${String(d.code ?? "engine_error")}).`;
    case "turn.correction":
      return `The buyer changed the agent's proposal on the order sheet (${String((d.edit as { kind?: string } | undefined)?.kind ?? "edit")}).`;
    case "turn.model_fallback":
      return "The agent's model did not answer in time; another model answered.";
    case "turn.grounding_refusal":
      return "A sentence the data does not back was not shown.";
    default:
      return "The day's model cap was reached.";
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

function pick(d: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (d[k] !== undefined && (typeof d[k] !== "object" || d[k] === null)) out[k] = d[k];
  return out;
}

/**
 * Wraps any LedgerStore: every appended entry also becomes an action event. The event is derived after the
 * entry is stored, and a failure in the stream can never fail the append.
 */
export class TappedLedgerStore implements LedgerStore {
  private readonly mapper = new LedgerToActions();

  constructor(
    private readonly inner: LedgerStore,
    private readonly stream: ActionStream,
  ) {
    this.mapper.prime(inner.all());
  }

  append(entry: LedgerEntry): void {
    this.inner.append(entry);
    try {
      const ev = this.mapper.toEvent(structuredClone(entry));
      if (ev) this.stream.emit(ev);
    } catch {
      // telemetry is best effort
    }
  }

  all(): readonly LedgerEntry[] {
    return this.inner.all();
  }
}
