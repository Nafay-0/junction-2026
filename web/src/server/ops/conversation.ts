import { DockError } from "@/core/errors";
import type { LedgerEntry } from "@/core/ledger";
import type { Runtime } from "@/server/runtime";

/**
 * One conversation between a kitchen and its own agent, as the wholesaler's operations staff read it: the turns in
 * order, and under each turn everything it caused, straight from the hash-chained ledger: the buyer's words or
 * tap, each model call (model, milliseconds, tokens, cached tokens, cost, fallbacks), each tool call, the reading,
 * the checks and answers, memory read and written, grounding refusals, the gate's decisions and sign-offs, with
 * the door it came through. Requests link to their own step-by-step trace (/ops/trace/<requestId>).
 *
 * Built from the ledger alone: entries of type `agent` carry `data.thread = { threadId, turnId, door }`; the
 * requests a turn opened or touched bring their own entries (intake, lookup, quote, decision, approval, order).
 */

export type ConversationEntry = { seq: number; at: string; type: string; event?: string; summary: string; requestId?: string; orderId?: string; ms?: number; model?: string; tool?: string; costUsd?: number | null; tokens?: { input?: number; output?: number; cached?: number } };
export type ConversationTurn = { turnId: string; door: string; at: string; said?: string; tapped?: unknown; status?: string; ms?: number; marks?: Record<string, number>; requests: string[]; orders: string[]; entries: ConversationEntry[]; model: { calls: number; ms: number; costUsd: number; inputTokens: number; cachedTokens: number; outputTokens: number } };
export type ConversationView = { threadId: string; orgId?: string; kitchen?: string; startedAt?: string; turns: ConversationTurn[]; totals: { turns: number; modelCalls: number; costUsd: number; toolCalls: number; groundingRefusals: number }; chain: { ok: boolean; length: number } };
export type ConversationSummary = { threadId: string; kitchen?: string; orgName?: string; startedAt: string; lastAt: string; turns: number; doors: string[]; lastWords?: string };

type Tag = { threadId?: string; turnId?: string; door?: string };
const tagOf = (e: LedgerEntry): Tag => ((e.data as { thread?: Tag }).thread ?? {}) as Tag;

function entryOf(e: LedgerEntry): ConversationEntry {
  const d = e.data as Record<string, unknown>;
  const num = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : undefined);
  return {
    seq: e.seq,
    at: e.at,
    type: e.type,
    ...(typeof d.event === "string" ? { event: d.event } : typeof d.step === "string" ? { event: d.step } : {}),
    summary: e.summary,
    ...(e.requestId ? { requestId: e.requestId } : {}),
    ...(e.orderId ? { orderId: e.orderId } : {}),
    ...(num("ms") !== undefined ? { ms: num("ms") } : {}),
    ...(typeof d.model === "string" ? { model: d.model } : {}),
    ...(typeof d.tool === "string" ? { tool: d.tool } : {}),
    ...(d.costUsd !== undefined ? { costUsd: (d.costUsd as number | null) ?? null } : {}),
    ...(d.event === "model_call" ? { tokens: { input: num("inputTokens"), output: num("outputTokens"), cached: num("cachedInputTokens") } } : {}),
  };
}

export async function conversationView(rt: Runtime, threadId: string): Promise<ConversationView> {
  const all = rt.dock.ledger.entries();
  const own = all.filter((e) => e.type === "agent" && tagOf(e).threadId === threadId);
  if (!own.length) throw new DockError(404, "conversation_not_found", `No conversation ${threadId} on this server.`);
  const turns = new Map<string, ConversationTurn>();
  const byRequest = new Map<string, string>(); // requestId → the first turn that touched it
  for (const e of own) {
    const tag = tagOf(e);
    const id = tag.turnId ?? "?";
    let t = turns.get(id);
    if (!t) turns.set(id, (t = { turnId: id, door: tag.door ?? "typed", at: e.at, requests: [], orders: [], entries: [], model: { calls: 0, ms: 0, costUsd: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 } }));
    const d = e.data as Record<string, unknown>;
    if (d.event === "turn") {
      if (typeof d.words === "string") t.said = d.words;
      if (d.action) t.tapped = d.action;
    }
    if (d.event === "turn_done") {
      t.status = String(d.status ?? "");
      t.marks = (d.marks ?? {}) as Record<string, number>;
      for (const r of (d.requests as string[] | undefined) ?? []) if (!t.requests.includes(r)) t.requests.push(r);
      for (const o of (d.orders as string[] | undefined) ?? []) if (!t.orders.includes(o)) t.orders.push(o);
    }
    if (d.event === "model_call") {
      t.model.calls++;
      t.model.ms += Number(d.ms ?? 0);
      t.model.costUsd += Number(d.costUsd ?? 0);
      t.model.inputTokens += Number(d.inputTokens ?? 0);
      t.model.cachedTokens += Number(d.cachedInputTokens ?? 0);
      t.model.outputTokens += Number(d.outputTokens ?? 0);
    }
    if (e.requestId && !t.requests.includes(e.requestId)) t.requests.push(e.requestId);
    if (e.requestId && !byRequest.has(e.requestId)) byRequest.set(e.requestId, id);
    t.entries.push(entryOf(e));
  }
  // The requests' own entries (the intake, lookups, quotes, the gate, sign-offs), under the turn that opened them
  // unless a later turn of the conversation was running when they were written.
  const ownSeqs = new Set(own.map((e) => e.seq));
  const spans = [...turns.values()].map((t) => ({ id: t.turnId, from: Math.min(...t.entries.map((x) => x.seq)), to: Math.max(...t.entries.map((x) => x.seq)) }));
  for (const e of all) {
    if (ownSeqs.has(e.seq) || !e.requestId || !byRequest.has(e.requestId)) continue;
    const inside = spans.find((s) => e.seq >= s.from && e.seq <= s.to)?.id;
    const t = turns.get(inside ?? byRequest.get(e.requestId)!)!;
    t.entries.push(entryOf(e));
    if (e.orderId && !t.orders.includes(e.orderId)) t.orders.push(e.orderId);
  }
  const list = [...turns.values()].map((t) => ({ ...t, entries: t.entries.sort((a, b) => a.seq - b.seq), ms: t.marks?.done }));
  list.sort((a, b) => a.entries[0].seq - b.entries[0].seq);
  const first = own[0];
  const chain = rt.dock.ledger.verify();
  const { threadStore } = await import("@/server/thread/engine");
  const live = (await threadStore()).byId(threadId) ?? (await threadStore()).all().find((t) => t.archived?.includes(threadId));
  // The thread's live view knows each turn's status and timings even while a turn still works.
  for (const t of list) {
    const a = live?.turns.find((x) => x.turnId === t.turnId);
    if (a?.role === "agent") {
      t.status ??= a.status;
      t.marks ??= a.marks as Record<string, number> | undefined;
    }
  }
  return {
    threadId,
    ...(live ? { kitchen: live.kitchen, orgId: live.orgId } : {}),
    startedAt: first.at,
    turns: list,
    totals: {
      turns: list.length,
      modelCalls: list.reduce((s, t) => s + t.model.calls, 0),
      costUsd: list.reduce((s, t) => s + t.model.costUsd, 0),
      toolCalls: own.filter((e) => (e.data as { event?: string }).event === "tool_call").length,
      groundingRefusals: own.filter((e) => (e.data as { event?: string }).event === "grounding_refusal").length,
    },
    chain: { ok: chain.ok, length: chain.ok ? chain.length : all.length },
  };
}

/** The latest conversations, newest first. */
export function conversationList(rt: Runtime, max = 30): ConversationSummary[] {
  const by = new Map<string, ConversationSummary & { turnIds: Set<string> }>();
  for (const e of rt.dock.ledger.entries()) {
    if (e.type !== "agent") continue;
    const tag = tagOf(e);
    if (!tag.threadId) continue;
    let c = by.get(tag.threadId);
    if (!c) by.set(tag.threadId, (c = { threadId: tag.threadId, startedAt: e.at, lastAt: e.at, turns: 0, doors: [], turnIds: new Set() }));
    c.lastAt = e.at;
    if (tag.turnId) c.turnIds.add(tag.turnId);
    if (tag.door && !c.doors.includes(tag.door)) c.doors.push(tag.door);
    const d = e.data as { event?: string; words?: string };
    if (d.event === "turn" && d.words) c.lastWords = d.words.slice(0, 120);
  }
  return [...by.values()]
    .map(({ turnIds, ...c }) => ({ ...c, turns: turnIds.size }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, max);
}
