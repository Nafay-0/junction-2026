import type { ModelMessage } from "ai";
import { z } from "zod";
import { DockError, parse } from "@/core/errors";
import { factsFrom, addWords } from "@/core/grounding";
import type { PublicOrder } from "@/core/orders";
import { newId } from "@/core/util";
import { resolveKitchen } from "@/server/console-kitchens";
import { groundForDisplay } from "@/server/grounding";
import type { Kitchen } from "@/server/kitchen-portal";
import { interactionFromIntake } from "@/server/memory/intake-events";
import { onsiteSession } from "@/server/ops/onsite";
import { getRuntime, type Runtime } from "@/server/runtime";
import { runAgent, remember, type AgentRunResult } from "./agent";
import { cardId, gateCard, orderCard } from "./cards";
import { withTurn } from "./context";
import { checkOpen, read, record, runAction, step, type ItemOutcome, type TurnRun } from "./pipeline";
import { earlierFor } from "./earlier";
import { ThreadStore, type StoredThread } from "./store";
import { ensureTelemetry } from "./telemetry";
import type { AgentTurn, BuyerTurn, MemoryCard, SubmitTurn, SubmitTurnReply, ThreadAction, ThreadDoor } from "./types";

/**
 * One conversation per kitchen, one engine for every door. A door submits a turn (typed words, a transcript, a tap
 * on a card); the engine answers with an agent turn whose cards and steps stream out as events (store.ts) while it
 * works. The HTTP call returns at once with the turn ids; the work runs on the server, so a reload or a dropped
 * connection loses nothing.
 *
 * Taps go straight to the plain-code engine (no model: the card says what the buyer chose). Words go to the agent
 * loop (agent.ts), which calls the same engine through its tools. A speculative reading of the words starts at
 * once, in parallel with the agent's first step, so the "understood" card does not wait for the agent to decide to
 * ask for it.
 */

const g = globalThis as typeof globalThis & { __dockThreads?: { store: ThreadStore; restored: Promise<void>; queues: Map<string, Promise<void>>; subscribed: WeakSet<Runtime> } };

async function engine(rt: Runtime) {
  if (!g.__dockThreads) {
    const store = new ThreadStore(rt.records<StoredThread>("agent_thread"));
    g.__dockThreads = { store, restored: store.restore().then(() => undefined, () => undefined), queues: new Map(), subscribed: new WeakSet() };
  }
  ensureTelemetry();
  const e = g.__dockThreads;
  await e.restored;
  if (!e.subscribed.has(rt)) {
    e.subscribed.add(rt);
    rt.events.subscribe(() => true, (ev) => void onOrderEvent(rt, ev.orgId, ev.orderId).catch(() => undefined));
  }
  return e;
}

export async function threadStore(): Promise<ThreadStore> {
  return (await engine(await getRuntime())).store;
}

const ActionSchema: z.ZodType<ThreadAction> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("concern"), requestId: z.string().min(1).max(80), key: z.string().min(1).max(200), choice: z.string().min(1).max(80) }),
  z.object({ type: z.literal("answer"), requestId: z.string().min(1).max(80), questionId: z.string().min(1).max(80), optionId: z.string().min(1).max(80), remember: z.boolean().optional() }),
  z.object({ type: z.literal("choose"), requestId: z.string().min(1).max(80), optionId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("place"), requestId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("withdraw"), orderId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("remember"), itemId: z.string().min(1).max(80), yes: z.boolean() }),
  z.object({ type: z.literal("retry"), turnId: z.string().min(1).max(80) }),
]);

export const SubmitTurnSchema = z
  .object({
    door: z.enum(["typed", "voice", "photo"]).default("typed"),
    via: z.enum(["typed", "speech", "tap", "photo"]).default("typed"),
    text: z.string().trim().min(1).max(2000).optional(),
    action: ActionSchema.optional(),
    label: z.string().max(200).optional(),
    clientTurnId: z.string().min(1).max(80).optional(),
    lang: z.enum(["en", "fi", "sv"]).optional(),
  })
  .refine((b) => b.text || b.action, "Send text, an action, or both.");

type Resolved = { rt: Runtime; k: Kitchen; session: Awaited<ReturnType<typeof onsiteSession>>; person?: NonNullable<Kitchen["console"]>["person"] };

/**
 * The kitchen and its agent's session for one turn. `k` is the kitchen as the store route resolved it for this
 * browser (server/authz.ts consoleKitchen: who may use it, and the signed-in person if any); without it (a sign-off
 * that arrives later) the kitchen is resolved again with no person.
 * Either way the session presents the kitchen's CURRENT mandate, read fresh every turn: resolveKitchen signs the demo
 * kitchens' mandate with every rule the kitchen added since (server/mandates.ts restrict) and returns a visitor's or
 * an account's stored one. Nothing here signs a mandate from defaults.
 */
async function resolve(slugOrKitchen: string | Kitchen, door: ThreadDoor): Promise<Resolved> {
  const rt = await getRuntime();
  const k = typeof slugOrKitchen === "string" ? await resolveKitchen(slugOrKitchen) : slugOrKitchen;
  if (!k) throw new DockError(404, "kitchen_not_found", "This kitchen does not exist or its demo time is over.");
  const session = { ...(await onsiteSession(rt.dock, k, `thread ${door} door`)), door: door === "voice" ? ("voice" as const) : door === "photo" ? ("photo" as const) : ("typed" as const) };
  const c = (k as Kitchen).console;
  if (c) session.share = `console:${c.session}`;
  return { rt, k: k as Kitchen, session, person: c?.person };
}

/** GET /thread: the kitchen's thread as a browser may see it. */
export async function readThread(k: Kitchen) {
  const rt = await getRuntime();
  const { store } = await engine(rt);
  return store.publicView(store.get(k.info.slug, k.info.orgId));
}

export async function resetThread(k: Kitchen) {
  const rt = await getRuntime();
  const { store } = await engine(rt);
  return store.publicView(store.reset(k.info.slug, k.info.orgId));
}

/** The kitchen's event log after `seq`, and a subscription to what comes next (the SSE route). */
export async function threadEvents(k: Kitchen) {
  const rt = await getRuntime();
  const { store } = await engine(rt);
  store.get(k.info.slug, k.info.orgId);
  return { after: (seq: number) => store.events(k.info.slug, seq), subscribe: (fn: Parameters<ThreadStore["subscribe"]>[1]) => store.subscribe(k.info.slug, fn) };
}

/** POST /thread/turns: accept a turn, open the agent turn, and work on it in the background. */
export async function submitTurn(kitchen: Kitchen | string, input: unknown): Promise<SubmitTurnReply> {
  const body = parse(SubmitTurnSchema, input) as SubmitTurn;
  const door = body.door;
  const r = await resolve(kitchen, door);
  const slug = r.k.info.slug;
  const e = await engine(r.rt);
  const thread = e.store.get(slug, r.k.info.orgId);
  if (body.clientTurnId && thread.seen[body.clientTurnId]) return { threadId: thread.threadId, ...thread.seen[body.clientTurnId], seq: thread.seq, duplicate: true };

  const now = new Date().toISOString();
  const buyer: BuyerTurn = { turnId: newId("trn"), role: "buyer", at: now, door, via: body.via, ...(body.text ? { text: body.text } : {}), ...(body.action ? { action: body.action } : {}), ...(body.label ? { label: body.label } : {}), ...(body.clientTurnId ? { clientTurnId: body.clientTurnId } : {}) };
  const agentTurn: AgentTurn = { turnId: newId("trn"), role: "agent", at: now, replyTo: buyer.turnId, status: "working", steps: [], cards: [] };
  e.store.addTurn(thread, buyer);
  e.store.addTurn(thread, agentTurn);
  e.store.status(thread, agentTurn.turnId, "working");
  if (body.clientTurnId) thread.seen[body.clientTurnId] = { buyerTurnId: buyer.turnId, agentTurnId: agentTurn.turnId };
  const t0 = Date.now();
  const run: TurnRun = { rt: r.rt, store: e.store, thread, turnId: agentTurn.turnId, buyer, k: r.k, session: r.session, person: r.person, door, t0, facts: [], requests: new Set(), orders: new Map(), readings: new Map() };
  // The first visible sign of work, before any model call.
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, fallbacks: 0, toolCalls: 0 };
  const turnCtx = () => ({ threadId: thread.threadId, turnId: agentTurn.turnId, door, kitchen: slug, orgId: r.k.info.orgId, agentId: r.session.agentId, usage });
  const first = step(run, body.action ? "tap" : "read", !body.action && body.text && worthReading(body.text) ? "Reading your request" : "On it");
  if (!body.action) run.opening = first;

  // A speculative reading of new words, in parallel with the agent's first step (agent.ts asks for the same reading).
  if (body.text && !body.action && worthReading(body.text)) {
    void withTurn(turnCtx(), () => earlierFor(run, body.text!).then((earlier) => read(run, body.text!, earlier))).catch(() => undefined);
  }

  // One agent turn at a time per thread: a turn sent while one works is answered next.
  const prev = e.queues.get(slug) ?? Promise.resolve();
  const next = prev.then(() =>
    withTurn(turnCtx(), () => work(run, body, first)).catch((err) => {
      console.error("[thread]", err);
      e.store.card(thread, agentTurn.turnId, { type: "notice", cardId: cardId("notice", agentTurn.turnId), kind: "error", message: "Something went wrong on our side. Try again.", retry: true });
      e.store.status(thread, agentTurn.turnId, "failed", { ms: Date.now() - t0 });
    }),
  );
  e.queues.set(slug, next);
  return { threadId: thread.threadId, buyerTurnId: buyer.turnId, agentTurnId: agentTurn.turnId, seq: thread.seq };
}

/** A short reply to an open card ("yes", "the second one") needs no fresh reading; a new request does. */
function worthReading(text: string): boolean {
  const t = text.trim();
  if (t.split(/\s+/).length <= 4 && !/\d/.test(t)) return false;
  if (/^(what|when|how|why|who|which|did|do|does|is there any|mitä|milloin|miten|miksi|kuka|vad|när|hur|varför)\b/i.test(t) && t.endsWith("?") && !/\d/.test(t)) return false;
  return true;
}

async function work(run: TurnRun, body: SubmitTurn, first: ReturnType<typeof step>): Promise<void> {
  const { store, thread } = run;
  record(run, "turn", body.action ? `The buyer tapped "${body.label ?? body.action.type}" (${run.door}).` : `The buyer said (${run.door}): "${(body.text ?? "").slice(0, 300)}"`, { via: body.via, ...(body.text ? { words: body.text.slice(0, 2000) } : {}), ...(body.action ? { action: body.action } : {}) });
  let line = "";
  let agentResult: AgentRunResult | undefined;
  try {
    if (body.action) {
      first.done();
      if (body.action.type === "remember") await remember(run, body.action.itemId, body.action.yes, body.text);
      else if (body.action.type === "retry") {
        const prev = store.turn(thread, body.action.turnId);
        const buyer = prev?.role === "agent" ? store.turn(thread, prev.replyTo) : prev;
        if (buyer?.role === "buyer" && buyer.text) {
          run.buyer = { ...run.buyer, text: buyer.text };
          agentResult = await agentTurn(run, buyer.text);
        }
      } else {
        await checkOpen(run, body.action);
        await runAction(run, body.action, body.text);
      }
    } else {
      agentResult = await agentTurn(run, body.text!);
      if (run.opening) first.done(); // no reading was needed (a reply to a card, a question)
    }
    line = agentResult?.text ?? "";
  } catch (err) {
    if (!(err instanceof DockError)) throw err;
    if (run.opening) first.done();
    store.card(thread, run.turnId, { type: "notice", cardId: cardId("notice", run.turnId), kind: err.code === "turn_card_stale" ? "refused" : err.status === 429 || err.status === 503 ? "unavailable" : "refused", message: err.message, ...(err.rule ? { rule: err.rule } : {}), retry: err.status >= 500 || err.status === 429 });
  }

  // A tap that left an order waiting for a person: the agent loop takes up the wait (the runtime's approval step).
  if (!agentResult) {
    const pending = [...run.orders.values()].find((o) => o.status === "pending_approval");
    if (pending) agentResult = await agentTurn(run, undefined, `[The order ${pending.orderId} now waits for ${pending.approval?.approver.name ?? "a person"}'s sign-off. Call await_sign_off for it, then write your one sentence.]`).catch(() => undefined);
    line = agentResult?.text ?? "";
  }

  if (line) await showLine(run, line);
  await finishTurn(run);
}

/** The end of an agent turn: what to remember, its status (waiting for the buyer, for a person, or done) and the record. */
async function finishTurn(run: TurnRun): Promise<void> {
  const { store, thread } = run;
  await proposeMemory(run);
  const a = store.agentTurn(thread, run.turnId)!;
  const waitingApprover = a.cards.some((c) => c.type === "gate" && c.outcome === "waiting");
  const waitingBuyer = !waitingApprover && a.cards.some((c) => (c.type === "anomaly" && !c.answered) || c.type === "question" || (c.type === "options" && !c.chosen) || (c.type === "price" && !a.cards.some((x) => x.type === "gate" && x.requestId === c.requestId)));
  store.mark(thread, run.turnId, "done", Date.now() - run.t0);
  store.status(thread, run.turnId, waitingApprover ? "waiting_approver" : waitingBuyer ? "waiting_buyer" : "done", { ms: Date.now() - run.t0, marks: a.marks });
  record(run, "turn_done", `Agent turn finished (${a.status}) in ${Date.now() - run.t0} ms: ${a.cards.map((c) => c.type).join(", ") || "no cards"}.`, { status: a.status, marks: a.marks, cards: a.cards.map((c) => c.type), requests: [...run.requests], orders: [...run.orders.keys()] });
}

// ---------- a door that converses itself (the voice call) ----------

/**
 * A turn of a door that runs its own conversation (the voice call's realtime model) but shares this thread: the
 * buyer's heard words become the buyer turn, and the door's step becomes the agent turn's cards, through the same
 * plain-code engine (so a routine order is placed alone here too). `work` gets the turn and returns what the door
 * should say; the turn is finished and recorded whatever happens. Never throws for the door: a failure here leaves
 * the call working exactly as before, without the mirror.
 */
export async function doorTurn<T>(kitchen: Kitchen | string, buyer: { door: ThreadDoor; via: BuyerTurn["via"]; text?: string; label?: string }, work: (run: TurnRun) => Promise<T>): Promise<T> {
  const r = await resolve(kitchen, buyer.door);
  const e = await engine(r.rt);
  const thread = e.store.get(r.k.info.slug, r.k.info.orgId);
  const now = new Date().toISOString();
  const b: BuyerTurn = { turnId: newId("trn"), role: "buyer", at: now, door: buyer.door, via: buyer.via, ...(buyer.text ? { text: buyer.text } : {}), ...(buyer.label ? { label: buyer.label } : {}) };
  const agentTurnRec: AgentTurn = { turnId: newId("trn"), role: "agent", at: now, replyTo: b.turnId, status: "working", steps: [], cards: [] };
  e.store.addTurn(thread, b);
  e.store.addTurn(thread, agentTurnRec);
  e.store.status(thread, agentTurnRec.turnId, "working");
  const run: TurnRun = { rt: r.rt, store: e.store, thread, turnId: agentTurnRec.turnId, buyer: b, k: r.k, session: r.session, person: r.person, door: buyer.door, t0: Date.now(), facts: [], requests: new Set(), orders: new Map(), readings: new Map() };
  return withTurn({ threadId: thread.threadId, turnId: run.turnId, door: buyer.door, kitchen: r.k.info.slug, orgId: r.k.info.orgId, agentId: r.session.agentId }, async () => {
    record(run, "turn", buyer.text ? `The buyer said (${buyer.door}): "${buyer.text.slice(0, 300)}"` : `The buyer ${buyer.label ?? "acted"} (${buyer.door}).`, { via: buyer.via, ...(buyer.text ? { words: buyer.text.slice(0, 2000) } : {}) });
    try {
      return await work(run);
    } finally {
      await finishTurn(run).catch(() => undefined);
    }
  });
}

/** A sentence the door's own code wrote (the read-back), shown as the agent's line after the same grounding check. */
export async function doorLine(run: TurnRun, text: string): Promise<void> {
  await showLine(run, text);
}

/** The agent loop for words (or a nudge from the engine), with the thread's history; the loop's messages are kept. */
async function agentTurn(run: TurnRun, words: string | undefined, nudge?: string): Promise<AgentRunResult> {
  const history = trim(run.thread.messages);
  const user: ModelMessage = { role: "user", content: words ?? nudge ?? "" };
  let res: AgentRunResult;
  try {
    res = await runAgent(run, [...history, user], { words });
  } catch (err) {
    throw err instanceof DockError ? err : new DockError(503, "agent_unavailable", "The agent did not answer. Try again in a moment.");
  }
  run.thread.messages = trim([...history, user, ...res.messages]);
  if (res.approval?.orderId) {
    // With the exact history the approval belongs to: the continuation must follow the request it answers.
    run.thread.waits[res.approval.orderId] = { approvalId: res.approval.approvalId, toolCallId: res.approval.toolCallId, turnId: run.turnId, messages: [...history, user, ...res.messages], context: res.context };
    record(run, "sign_off_wait", `The agent paused for the sign-off of ${res.approval.orderId} (approval request ${res.approval.approvalId}).`, { orderId: res.approval.orderId, approvalId: res.approval.approvalId });
  }
  run.store.save(run.thread);
  return res;
}

/**
 * The last few exchanges only, cut at a user message so tool calls and results stay paired, and without the model's
 * reasoning: a provider binds a reasoning block to the exact conversation it was made in (Anthropic refuses a signed
 * thinking block replayed under another system prompt), and the turn context changes every turn.
 */
function trim(messages: ModelMessage[], keepUsers = 4): ModelMessage[] {
  let start = 0;
  let users = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && ++users === keepUsers) {
      start = i;
      break;
    }
  }
  return messages.slice(start).flatMap((m): ModelMessage[] => {
    if (m.role !== "assistant" || typeof m.content === "string") return [m];
    const content = m.content.filter((p) => p.type !== "reasoning");
    return content.length ? [{ ...m, content }] : [];
  });
}

/**
 * The model's sentence, shown only if every figure, date, product and claim in it is in the data the buyer has in
 * front of them: this turn's tool results and cards, and the records of the requests still on screen (a follow-up
 * question about the options shown a turn ago is answered from those options).
 */
async function showLine(run: TurnRun, text: string): Promise<void> {
  const one = text.replace(/\s+/g, " ").trim().slice(0, 280);
  const onScreen = [...new Set(run.store.cards(run.thread).flatMap((x) => ("requestId" in x.card && x.card.requestId ? [x.card.requestId] : [])))].slice(-3);
  const steps = await Promise.all(onScreen.map((id) => run.rt.dock.intake.get(run.session, id).catch(() => undefined)));
  const facts = addWords(factsFrom(...run.facts, ...steps.filter(Boolean), run.store.cards(run.thread).slice(-12).map((x) => x.card)), run.buyer.text ?? "");
  const g = groundForDisplay("thread", one, facts, { where: `thread ${run.thread.threadId}` });
  if (g.violations.length) {
    record(run, "grounding_refusal", `The agent's sentence was not shown: it said ${g.violations.map((v) => `"${v.said}" (${v.kind})`).join(", ")}, which the data does not back.`, { said: one, violations: g.violations });
    return;
  }
  run.store.line(run.thread, run.turnId, one);
  run.store.mark(run.thread, run.turnId, "line", Date.now() - run.t0);
}

/** After an order: what the memory writer proposes to remember, for the kitchen's person to keep or drop. */
async function proposeMemory(run: TurnRun): Promise<void> {
  const orders = [...run.orders.values()].filter((o) => o.status === "committed" || o.status === "pending_approval");
  if (!orders.length || process.env.DOCK_MEMORY === "off") return;
  try {
    const { getMemoryService } = await import("@/server/memory/runtime");
    const memory = await getMemoryService();
    const st = step(run, "memory", "Noting what to remember");
    const proposals: MemoryCard["proposals"] = [];
    const used: string[] = [];
    for (const o of orders) {
      const intake = await run.rt.dock.intake.get(run.session, o.requestId);
      used.push(...intake.memoryUsed.map((m) => m.text));
      const profile = await memory.load(run.k.info.orgId, run.k.info.name);
      const { segments, events } = interactionFromIntake(profile, intake as never);
      const report = await memory.write(run.k.info.orgId, { door: run.door === "voice" ? "voice" : "typed", by: run.person?.name ?? run.k.info.by, requestId: o.requestId, orderId: o.orderId, segments, events }, run.k.info.name);
      proposals.push(...report.questions.map((q) => ({ itemId: q.itemId, question: q.question })));
      record(run, "memory_write", `The memory writer read this order: ${report.outcomes.length} outcome(s), ${report.questions.length} to confirm.`, { orderId: o.orderId, outcomes: report.outcomes.length, questions: report.questions }, o.requestId);
    }
    st.done(`${proposals.length}`);
    if (proposals.length || used.length) run.store.card(run.thread, run.turnId, { type: "memory", cardId: cardId("memory", run.turnId), used: [...new Set(used)], proposals: proposals.slice(0, 3) });
  } catch {
    // memory is a help, never a blocker
  }
}

// ---------- sign-off on the approver's phone ----------

/**
 * An order changed outside the thread (the approver signed or declined on their phone, it expired, the buyer took it
 * back elsewhere): update its cards, and answer the agent loop's pending approval, which only the server can.
 */
async function onOrderEvent(rt: Runtime, orgId: string, orderId: string): Promise<void> {
  const e = g.__dockThreads;
  if (!e) return;
  for (const t of e.store.all()) {
    if (t.orgId !== orgId) continue;
    const kitchen = t.kitchen;
    const holder = e.store.cards(t).find((x) => (x.card.type === "gate" || x.card.type === "order") && x.card.orderId === orderId);
    if (!holder) continue;
    const r = await resolve(kitchen, "typed");
    const order: PublicOrder = await rt.dock.getOrder(r.session, orderId);
    e.store.card(t, holder.turnId, gateCard(order));
    const prevOrder = e.store.cards(t).find((x) => x.card.type === "order" && x.card.orderId === orderId);
    e.store.card(t, holder.turnId, orderCard(order, prevOrder?.card.type === "order" ? prevOrder.card.passedOver : []));
    if (order.status === "pending_approval") return;
    const wait = t.waits[orderId];
    if (!wait) {
      const a = e.store.agentTurn(t, holder.turnId);
      if (a?.status === "waiting_approver") e.store.status(t, holder.turnId, "done", { ms: a.ms });
      return;
    }
    delete t.waits[orderId];
    await resumeAfterSignOff(rt, kitchen, t, wait, order);
  }
}

/** The approver decided: the runtime's approval answered (approved only when the gate committed it), and the loop goes on. */
async function resumeAfterSignOff(rt: Runtime, kitchen: string, t: StoredThread, wait: StoredThread["waits"][string], order: PublicOrder): Promise<void> {
  const e = g.__dockThreads!;
  const r = await resolve(kitchen, "typed");
  const holder = e.store.agentTurn(t, wait.turnId);
  if (!holder) return;
  const buyer = e.store.turn(t, holder.replyTo) as BuyerTurn;
  const run: TurnRun = { rt, store: e.store, thread: t, turnId: wait.turnId, buyer, k: r.k, session: r.session, person: undefined, door: buyer.door, t0: Date.now(), facts: [order], requests: new Set([order.requestId]), orders: new Map([[order.orderId, order]]), readings: new Map() };
  const approved = order.status === "committed";
  const saved = wait.messages;
  const response: ModelMessage = { role: "tool", content: [{ type: "tool-approval-response", approvalId: wait.approvalId, approved, reason: approved ? `${order.approval?.approver.name ?? "The approver"} signed it off with their passkey.` : `The order is ${order.status}.` }] };
  await withTurn({ threadId: t.threadId, turnId: wait.turnId, door: buyer.door, kitchen, orgId: t.orgId, agentId: r.session.agentId }, async () => {
    record(run, "sign_off_answered", `The sign-off of ${order.orderId} was recorded (${order.status}); the agent's pending approval was answered by the server: ${approved ? "approved" : "not approved"}.`, { orderId: order.orderId, approvalId: wait.approvalId, approved }, order.requestId);
    try {
      const res = await runAgent(run, [...saved, response], { context: wait.context });
      t.messages = trim([...saved, response, ...res.messages]);
      if (res.text) await showLine(run, res.text);
    } catch {
      // the cards already show the outcome
    }
    e.store.status(t, wait.turnId, "done", { ms: holder.ms });
    e.store.save(t);
  });
}

export type { ItemOutcome };
