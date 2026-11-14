import { randomBytes } from "node:crypto";
import { isStepCount, ToolLoopAgent, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { z } from "zod";
import { DockError } from "@/core/errors";
import { localNow } from "@/core/kitchen";
import { createModel, defaultModel } from "@/server/agent/models";
import { yesOrNo } from "@/server/channels/speech";
import { overview } from "@/server/kitchen-portal";
import { reserveLlmCall } from "@/server/limits";
import { callTool } from "@/server/mcp/server";
import { TOOLS } from "@/server/mcp/tools";
import { cardId, gateCard, orderCard } from "./cards";
import { withFallback } from "./fallback";
import { orderFromWords, record, runAction, step, type ItemOutcome, type TurnRun } from "./pipeline";
import type { RecordsCard, ThreadAction } from "./types";
import { earlierFor } from "./earlier";

/**
 * The kitchen's agent on the AI SDK's agent loop (ToolLoopAgent). It orchestrates and converses; the plain-code
 * engine (pipeline.ts) and the gate do the work. Its tool table is the one the open interface publishes
 * (server/mcp/tools.ts, every tool run through the same callTool the MCP door uses) plus four thread tools.
 *
 *   order           the buyer's words → the reader → the intake → cards (and a routine order placed alone)
 *   buyer_reply     the newest buyer words mapped onto a card that is open now (checked by code)
 *   order_history   "what did we order last week?" → a records card
 *   await_sign_off  pauses the loop until the named person signs on their phone: the runtime's approval step,
 *                   answered only by the server when the passkey sign-off is recorded
 *
 * The published tools that carry a buyer's answer or commit to an order (respond_to_concerns, answer_questions,
 * choose_option, place_order, submit_need, open_request, request_quote) are in the table but not offered to the
 * model (activeTools), and the runtime's approval layer denies them if it ever calls one (toolApproval): those steps
 * are the buyer's, through buyer_reply and the cards, or the engine's.
 */

export const AGENT_INSTRUCTIONS = `You are the purchasing agent of one restaurant or catering kitchen, working inside its wholesaler's food-service store. You are not a chatbot: the store shows your work as cards built from data (what you understood, a flagged anomaly, a question, options with live prices, a fixed price, the gate's decision, the order, what memory used). Your words are at most one short sentence on top of those cards.

How to work each turn:
- The buyer wants to buy something, change or repeat an order, adjust an amount, ask for a variant ("is there a lactose-free one?"), or names several items: call order with their own words, copied exactly. One call per message is enough: several items in one message are split by code. For "same as last Thursday but double" or "make it 200 litres", pass the words as they are: code reads them against earlier requests.
- The buyer's newest words answer something open (listed under OPEN DECISIONS): call buyer_reply with the matching ref. "the second one" is o2. "yes", "that's right", "the chef said yes" confirm a check. Only use refs that are listed. If their words do not clearly pick one, ask one short question instead.
- After an order waits for a named person's sign-off (status pending_approval), write your one sentence (who signs, on their phone) and call await_sign_off with its orderId in the same reply. Do not try to place, retry or split it.
- Questions about past orders: order_history. About rules, limits or who signs off: read_mandate or read_kitchen_memory. About an order's status or why something happened: get_order or explain.
- A dish or a menu for a number of covers ("salmon soup for 300 on Friday"): the menu planner works out the ingredients; say in one sentence that the Menu page plans it into one order. No tool.
- Anything else (a greeting, small talk, something outside buying food): one short sentence, no tool.

Your sentence:
- One sentence, at most 20 words, in the buyer's language (English, Finnish or Swedish: the language they wrote in).
- Never write a product name, price, amount, date, delivery day, stock level, allergen or diet claim unless a tool result in this turn states it exactly. Prefer pointing at the cards ("Three options below; the first is what you usually order.").
- Never say an order is placed, confirmed or approved unless a tool result says so. A waiting order is waiting.
- A requested day is the latest acceptable day: an option delivered earlier meets it. Do not restate what the cards already show.
- If memory answered something, say so in a few words ("Lactose-free, as you always order.").
- No greetings, no apologies, no lists, no markdown, no ids.`;

const PUBLISHED_FOR_MODEL = ["read_mandate", "read_kitchen_memory", "get_intake_step", "get_order", "explain"] as const;
const BUYERS_OR_ENGINES = ["submit_need", "respond_to_concerns", "answer_questions", "choose_option", "place_order", "open_request", "request_quote", "search_products", "check_availability"] as const;

/** One secret per process unless configured: an approval signed by another process (after a restart) is refused, and the card still updates from the order itself. */
const approvalSecret = process.env.DOCK_TOOL_APPROVAL_SECRET || randomBytes(32).toString("base64");

let modelForTests: { model: LanguageModel; id: string } | undefined;
/** Tests and recorded runs: the agent's model, instead of DOCK_AGENT_MODEL. */
export function setAgentModelForTests(m: { model: LanguageModel; id: string } | undefined): void {
  modelForTests = m;
}

function modelFor(spec: string | undefined, onFallback: (i: { from: string; to: string; reason: string }) => void): { model: LanguageModel; id: string } {
  if (modelForTests) return modelForTests;
  const primarySpec = spec ?? defaultModel("DOCK_AGENT_MODEL");
  if (!primarySpec) throw new DockError(503, "model_unavailable", "No model is configured for the store agent: set DOCK_AGENT_MODEL or a provider key.");
  const primary = createModel(primarySpec).model as LanguageModelV4;
  const fallbackSpec = process.env.DOCK_AGENT_FALLBACK_MODEL || process.env.DOCK_INTERPRET_MODEL;
  const fallback = fallbackSpec && fallbackSpec !== primarySpec ? (createModel(fallbackSpec).model as LanguageModelV4) : undefined;
  const firstChunkMs = Number(process.env.DOCK_AGENT_FIRST_TOKEN_MS ?? 6000) || 6000;
  return { model: withFallback(primary, fallback, { firstChunkMs, totalMs: firstChunkMs * 3, onFallback }), id: primarySpec };
}

/** What the model sees of a tool result: short, no tokens or signatures. */
function compact(v: unknown, max = 2500): string {
  const s = JSON.stringify(v, (k, x) => (k === "quoteToken" || k === "confirmation" || k === "hash" || k === "prevHash" || k === "signature" ? undefined : x));
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const forModel = (items: ItemOutcome[]) =>
  items.map((i) => ({
    requestId: i.requestId,
    state: i.state,
    ...(i.notice ? { notice: i.notice.kind, message: i.notice.message } : {}),
    ...(i.concerns ? { flagged: i.concerns } : {}),
    ...(i.questions ? { questions: i.questions } : {}),
    ...(i.options ? { options: i.options.map((o) => ({ ref: o.ref, title: o.title, totalEur: (o.totalCents / 100).toFixed(2), delivery: o.deliveryDate, match: o.match })) } : {}),
    ...(i.placed ? { order: { orderId: i.placed.orderId, status: i.placed.status, totalEur: (i.placed.totalCents / 100).toFixed(2), ...(i.placed.approver ? { waitsFor: i.placed.approver } : {}) } } : {}),
  }));

// ---------- open decisions: what buyer_reply may map words onto ----------

export type OpenRef = { ref: string; label: string; action: ThreadAction; confirm?: boolean };

/** Every decision open in the thread right now, newest request first, with the ref the model may name. */
export async function openRefs(run: TurnRun): Promise<OpenRef[]> {
  const refs: OpenRef[] = [];
  const seen = new Set<string>();
  const cards = run.store.cards(run.thread).reverse();
  let c = 0;
  let q = 0;
  for (const { card } of cards) {
    if (!("requestId" in card) || !card.requestId || seen.has(`${card.type}:${card.requestId}`)) continue;
    seen.add(`${card.type}:${card.requestId}`);
    const requestId = card.requestId;
    if (card.type === "anomaly" && !card.answered) {
      const s = await run.rt.dock.intake.get(run.session, requestId).catch(() => undefined);
      if (s?.state !== "needs_confirmation") continue;
      for (const k of s.concerns) {
        c++;
        if (k.confirmable) refs.push({ ref: `c${c}:confirm`, label: `confirm "${k.message}"`, action: { type: "concern", requestId, key: k.key, choice: "confirm" }, confirm: true });
        for (const x of k.corrections) refs.push({ ref: `c${c}:${x.id}`, label: `${x.label} (for "${k.message}")`, action: { type: "concern", requestId, key: k.key, choice: x.id } });
      }
    } else if (card.type === "question") {
      const s = await run.rt.dock.intake.get(run.session, requestId).catch(() => undefined);
      if (s?.state !== "needs_input") continue;
      for (const x of s.questions) {
        q++;
        for (const o of x.options) refs.push({ ref: `q${q}:${o.id}`, label: `${o.label} (answer to "${x.text}")`, action: { type: "answer", requestId, questionId: x.id, optionId: o.id } });
      }
    } else if (card.type === "options" && !card.chosen && !refs.some((r) => r.ref.startsWith("o"))) {
      const s = await run.rt.dock.intake.get(run.session, requestId).catch(() => undefined);
      if (s?.state !== "options_ready") continue;
      card.options.forEach((o, i) => refs.push({ ref: `o${i + 1}`, label: `order option ${i + 1}: ${o.title}, €${(o.totalCents / 100).toFixed(2)}, delivery ${o.deliveryDate}${o.match === "compromise" ? `, compromise: ${o.givesUp.join("; ")}` : ""}`, action: { type: "choose", requestId, optionId: o.optionId } }));
    } else if (card.type === "price") {
      const s = await run.rt.dock.intake.get(run.session, requestId).catch(() => undefined);
      if (s?.state !== "quoted") continue;
      if (!(await placedAlready(run, requestId))) refs.push({ ref: "place", label: `order at the fixed price €${(card.totalCents / 100).toFixed(2)}`, action: { type: "place", requestId }, confirm: true });
    } else if (card.type === "gate" && card.outcome === "waiting" && card.orderId) {
      refs.push({ ref: "withdraw", label: "take back the order waiting for sign-off", action: { type: "withdraw", orderId: card.orderId } });
    }
  }
  for (const { card } of cards) {
    if (card.type !== "memory") continue;
    card.proposals.forEach((p, i) => {
      if (p.decided) return;
      refs.push({ ref: `m${i + 1}:keep`, label: `remember: ${p.question}`, action: { type: "remember", itemId: p.itemId, yes: true } });
      refs.push({ ref: `m${i + 1}:drop`, label: `do not remember: ${p.question}`, action: { type: "remember", itemId: p.itemId, yes: false } });
    });
    break;
  }
  return refs;
}

async function placedAlready(run: TurnRun, requestId: string): Promise<boolean> {
  return run.store.cards(run.thread).some((x) => x.card.type === "gate" && x.card.requestId === requestId && x.card.outcome !== "refused");
}

/** The context the model gets each turn, after the cached instructions: today, the kitchen, and what is open. */
export function turnContext(run: TurnRun, refs: OpenRef[]): string {
  const today = localNow(new Date()).date;
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const waiting = run.store.cards(run.thread).filter((x) => x.card.type === "gate" && x.card.outcome === "waiting").map((x) => (x.card.type === "gate" ? `${x.card.orderId} waits for ${x.card.approver?.name ?? "a person"}` : ""));
  return [
    `Today is ${weekday} ${today} (Helsinki). Kitchen: ${run.k.info.name}. You are ${run.k.info.agentName}. This turn came through the ${run.door === "voice" ? "voice door (spoken)" : "store (typed)"}.`,
    refs.length ? `OPEN DECISIONS (ref: what it does):\n${refs.map((r) => `- ${r.ref}: ${r.label}`).join("\n")}` : "OPEN DECISIONS: none.",
    waiting.length ? `Waiting for sign-off: ${waiting.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- the agent ----------

export type AgentRunResult = { text: string; messages: ModelMessage[]; approval?: { approvalId: string; toolCallId: string; orderId: string }; items: ItemOutcome[]; model: string; context: string };

/** `context`: the turn context to use (a resumed sign-off wait reuses its own, so the conversation the model's reasoning is bound to stays the same). */
export async function runAgent(run: TurnRun, messages: ModelMessage[], opts: { words?: string; context?: string } = {}): Promise<AgentRunResult> {
  const items: ItemOutcome[] = [];
  const refs = await openRefs(run);
  const context = opts.context ?? turnContext(run, refs);
  const words = opts.words ?? run.buyer.text ?? "";
  let usedReply = false;

  const published: ToolSet = {};
  for (const t of TOOLS) {
    published[t.name] = tool({
      description: t.description,
      inputSchema: t.input,
      execute: async (args: unknown) => {
        try {
          const out = await callTool(run.rt, run.session, t, args);
          run.facts.push(out);
          return out as Record<string, unknown>;
        } catch (err) {
          if (err instanceof DockError) return { ok: false, error: { code: err.code, rule: err.rule, message: err.message } };
          throw err;
        }
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    });
  }

  const threadTools = {
    order: tool({
      description: "Start or change an order from the buyer's own words: read them, check them against the kitchen's history and the assortment, rank options with live prices, and place a routine order inside the mandate. Shows its work as cards.",
      inputSchema: z.object({ words: z.string().min(1).max(2000).describe("The buyer's words, copied exactly from their newest message (or the part of it about the purchase).") }),
      execute: async ({ words: w }) => {
        // The model may only pass on words the buyer said: anything else is read from the buyer's message itself.
        const said = words.includes(w.trim()) ? w.trim() : words;
        const earlier = await earlierFor(run, said);
        const out = await orderFromWords(run, said, earlier, { quietIfNotPurchase: true });
        items.push(...out);
        return forModel(out);
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    buyer_reply: tool({
      description: "The buyer's newest words answer one of the OPEN DECISIONS: pass its ref. Code checks that it is open and that a confirmation is a clear yes in their words.",
      inputSchema: z.object({ ref: z.string().min(1).max(40).describe("A ref from OPEN DECISIONS, e.g. o2, c1:confirm, q1:cheapest, place, m1:keep.") }),
      execute: async ({ ref }) => {
        const r = refs.find((x) => x.ref === ref);
        if (!r) return { ok: false, refused: "not_open", say: "That is not one of the open decisions. Ask the buyer which one they mean." };
        if (usedReply) return { ok: false, refused: "one_decision_per_message", say: "One decision per message." };
        if (r.confirm && yesOrNo(words) === "no") return { ok: false, refused: "not_a_yes", say: `The buyer's words ("${words.slice(0, 80)}") are not a yes. Ask again.` };
        usedReply = true;
        if (r.action.type === "remember") {
          const out = await remember(run, r.action.itemId, r.action.yes, words);
          return out;
        }
        const out = await runAction(run, r.action, words);
        items.push(...out);
        return forModel(out);
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    order_history: tool({
      description: "The kitchen's orders between two dates (inclusive), optionally one product family, for questions like 'what did we order last week?'. Shows them as a records card.",
      inputSchema: z.object({ from: z.iso.date().describe("YYYY-MM-DD"), to: z.iso.date().describe("YYYY-MM-DD"), family: z.string().max(40).optional().describe("e.g. milk, cream, butter") }),
      execute: async ({ from, to, family }) => {
        const st = step(run, "records", "Reading your order history");
        const ov = await overview(run.k);
        const rows = ov.orders
          .filter((o) => (o.deliveryDate || o.createdAt.slice(0, 10)) >= from && (o.deliveryDate || o.createdAt.slice(0, 10)) <= to)
          .filter((o) => !family || o.lines.some((l) => l.name.toLowerCase().includes(family.toLowerCase())) || ov.requests.some((r) => r.order?.orderId === o.orderId && r.family === family))
          .slice(0, 12);
        st.done(`${rows.length}`);
        const card: RecordsCard = {
          type: "records",
          cardId: cardId("records", run.turnId),
          question: words.slice(0, 200),
          rows: rows.map((o) => ({ kind: "order", label: o.lines.map((l) => `${l.quantity} × ${l.name}`).join(", "), totalCents: o.totalCents, date: o.deliveryDate, ref: o.requestId ?? o.orderId, detail: o.status })),
          ...(rows[0]?.requestId ? { repeat: { ref: rows[0].requestId, label: rows[0].lines[0]?.name ?? "" } } : {}),
        };
        run.store.card(run.thread, run.turnId, card);
        run.facts.push(card);
        record(run, "memory_read", `Order history read for ${from}..${to}${family ? ` (${family})` : ""}: ${rows.length} orders.`, { from, to, family, orders: rows.map((r) => r.orderId) });
        return { orders: rows.map((o) => ({ delivered: o.deliveryDate, status: o.status, totalEur: (o.totalCents / 100).toFixed(2), lines: o.lines.map((l) => `${l.quantity} × ${l.name}`) })) };
      },
      toModelOutput: ({ output }) => ({ type: "text", value: compact(output) }),
    }),
    await_sign_off: tool({
      description: "Wait for the named person to sign the order off on their own phone. Call it once, right after an order is pending_approval. The loop pauses until they decide.",
      inputSchema: z.object({ orderId: z.string().min(1).max(60) }),
      execute: async ({ orderId }) => {
        const o = await run.rt.dock.getOrder(run.session, orderId);
        run.facts.push(o);
        run.store.card(run.thread, run.turnId, gateCard(o));
        run.store.card(run.thread, run.turnId, orderCard(o));
        return { orderId, status: o.status, totalEur: (o.totalCents / 100).toFixed(2), ...(o.approval ? { decidedBy: o.approval.approver.name, decision: o.approval.status } : {}) };
      },
    }),
  };

  const tools = { ...published, ...threadTools } as ToolSet;
  let fellBack = "";
  const { model, id } = modelFor(undefined, (i) => {
    fellBack = i.to;
    run.store.step(run.thread, run.turnId, { stepId: `fb${Date.now()}`, kind: "model", label: "The first model did not answer in time; a second one answers", status: "done", startedAt: new Date().toISOString(), detail: i.reason });
    record(run, "model_fallback", `The agent's model ${i.from} did not answer in time (${i.reason}); ${i.to} answered instead.`, i);
  });

  const deny = (why: string) => ({ type: "denied" as const, reason: why });
  const agent = new ToolLoopAgent({
    id: "dock-store-agent",
    model,
    instructions: [
      { role: "system", content: AGENT_INSTRUCTIONS, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
      { role: "system", content: context },
    ],
    tools,
    activeTools: [...PUBLISHED_FOR_MODEL, "order", "buyer_reply", "order_history", "await_sign_off"],
    toolApproval: {
      ...Object.fromEntries(BUYERS_OR_ENGINES.map((n) => [n, deny(`${n} is the buyer's decision or the engine's step in the store: use buyer_reply or order.`)])),
      // The pause for a person's sign-off. Only the server answers it, when the passkey sign-off is recorded.
      await_sign_off: { type: "user-approval", reason: "Waiting for the named person's passkey sign-off on their phone." },
    },
    experimental_toolApprovalSecret: approvalSecret,
    stopWhen: isStepCount(5),
    maxOutputTokens: 600,
    telemetry: { functionId: "thread.agent" },
    reasoning: (process.env.DOCK_AGENT_REASONING as "low" | "medium" | "high" | "none" | undefined) ?? "low",
    prepareStep: async () => {
      reserveLlmCall(); // the daily caps: every agent step counts (server/limits.ts)
      return {};
    },
    repairToolCall: async ({ toolCall, error }) => {
      // A call to a tool the model may not use, or with arguments that do not fit: dropped, recorded, never guessed at.
      record(run, "tool_call_repaired", `The agent's call to ${toolCall.toolName} did not fit its schema and was dropped (${String((error as Error).message).slice(0, 160)}).`, { tool: toolCall.toolName });
      return null;
    },
  });

  const result = await agent.stream({ messages, timeout: { totalMs: 90_000, toolMs: 60_000 } });
  for await (const part of result.fullStream) {
    if (part.type === "tool-call" && !["order", "buyer_reply", "order_history", "await_sign_off"].includes(part.toolName)) {
      const st = step(run, `tool:${part.toolName}`, LABELS[part.toolName] ?? `Looking up ${part.toolName.replace(/_/g, " ")}`);
      void result.steps.then(() => st.done(), () => st.fail());
    }
  }
  const [text, response, content] = await Promise.all([result.text, result.response, result.content]);
  let approval: AgentRunResult["approval"];
  for (const p of content) {
    if (p.type === "tool-approval-request" && !p.isAutomatic && p.toolCall.toolName === "await_sign_off") {
      approval = { approvalId: p.approvalId, toolCallId: p.toolCall.toolCallId, orderId: String((p.toolCall.input as { orderId?: string }).orderId ?? "") };
    }
  }
  return { text: text.trim(), messages: response.messages, approval, items, model: fellBack || id, context };
}

const LABELS: Record<string, string> = {
  read_mandate: "Reading your mandate",
  read_kitchen_memory: "Reading what we remember about your kitchen",
  get_intake_step: "Checking where the request stands",
  get_order: "Checking the order",
  explain: "Reading the audit trail",
};

/** A memory proposal kept or dropped by the kitchen's person (memory service confirm), shown on its card. */
export async function remember(run: TurnRun, itemId: string, yes: boolean, words?: string): Promise<Record<string, unknown>> {
  const { getMemoryService } = await import("@/server/memory/runtime");
  const memory = await getMemoryService();
  const st = step(run, "memory", yes ? "Remembering it" : "Leaving it out");
  try {
    const r = await memory.confirm(run.session.mandate.issuer.orgId, itemId, yes, run.person?.name ?? run.k.info.by);
    st.done(r.outcome);
    record(run, "memory_write", `${yes ? "Kept" : "Dropped"} a memory proposal (${itemId}): ${r.outcome}.`, { itemId, yes, outcome: r.outcome, ...(words ? { heard: words.slice(0, 300) } : {}) });
    for (const { turnId, card } of run.store.cards(run.thread)) {
      if (card.type === "memory" && card.proposals.some((p) => p.itemId === itemId)) {
        run.store.card(run.thread, turnId, { ...card, proposals: card.proposals.map((p) => (p.itemId === itemId ? { ...p, decided: yes ? "kept" : "dropped" } : p)) });
      }
    }
    return { ok: true, outcome: r.outcome };
  } catch (err) {
    st.fail(err instanceof DockError ? err.code : undefined);
    if (err instanceof DockError) return { ok: false, error: err.message };
    throw err;
  }
}
