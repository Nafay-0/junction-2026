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
import { llmRoom } from "@/server/limits";
import { getRuntime, type Runtime } from "@/server/runtime";
import { runAgent, remember, type AgentRunResult } from "./agent";
import { cardId, gateCard, orderCard } from "./cards";
import { withTurn } from "./context";
import { checkOpen, read, record, runAction, step, type ItemOutcome, type TurnRun } from "./pipeline";
import { earlierFor } from "./earlier";
import { ThreadStore, type StoredThread } from "./store";
import { runWidget } from "./widgets";
import { speakFacts } from "./speak";
import { codeLeaks, englishDays, insideOrTell } from "./refusal";
import { fixTypos } from "./pipeline";
import { hasToday, helsinkiToday, postToday, todayCardId } from "./home";
import { ensureTelemetry } from "./telemetry";
import type { AgentTurn, BuyerTurn, GateCard, MemoryCard, OrderCard, RecordsCard, SubmitTurn, SubmitTurnReply, ThreadAction, ThreadDoor } from "./types";

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

const words = z.array(z.string().min(1).max(40)).max(14).optional();
const RulesChangeSchema = z.object({
  forbidAdd: words,
  forbidRemove: words,
  requireAdd: words,
  requireRemove: words,
  groupsAdd: words,
  groupsRemove: words,
  perOrderLimitEur: z.number().min(0).max(200000).optional(),
  weeklyBudgetEur: z.number().min(0).max(200000).optional(),
  maxLeadDays: z.number().int().min(1).max(30).optional(),
  signer: z.string().trim().min(2).max(60).optional(),
  substitution: z.enum(["within_preferences", "needs_approval", "none"]).optional(),
});

const ActionSchema: z.ZodType<ThreadAction> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("concern"), requestId: z.string().min(1).max(80), key: z.string().min(1).max(200), choice: z.string().min(1).max(80) }),
  z.object({ type: z.literal("answer"), requestId: z.string().min(1).max(80), questionId: z.string().min(1).max(80), optionId: z.string().min(1).max(80), remember: z.boolean().optional() }),
  z.object({ type: z.literal("choose"), requestId: z.string().min(1).max(80), optionId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("place"), requestId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("withdraw"), orderId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("remember"), itemId: z.string().min(1).max(80), yes: z.boolean() }),
  z.object({ type: z.literal("retry"), turnId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("repeat"), ref: z.string().min(1).max(80) }),
  z.object({ type: z.literal("sheet_packs"), sheetId: z.string().min(1).max(80), version: z.number().int(), lineId: z.string().min(1).max(80), packs: z.number().int().min(1).max(9999) }),
  z.object({ type: z.literal("sheet_day"), sheetId: z.string().min(1).max(80), version: z.number().int(), date: z.iso.date() }),
  z.object({ type: z.literal("sheet_swap"), sheetId: z.string().min(1).max(80), version: z.number().int(), lineId: z.string().min(1).max(80), productId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("sheet_remove"), sheetId: z.string().min(1).max(80), version: z.number().int(), lineId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("sheet_add"), sheetId: z.string().min(1).max(80).optional(), version: z.number().int().optional(), productId: z.string().min(1).max(80), packs: z.number().int().min(1).max(9999).optional() }),
  z.object({ type: z.literal("sheet_alternatives"), sheetId: z.string().min(1).max(80), lineId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("sheet_place"), sheetId: z.string().min(1).max(80), version: z.number().int() }),
  z.object({ type: z.literal("sheet_from_option"), requestId: z.string().min(1).max(80), optionId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("alt_rerank"), pickerId: z.string().min(1).max(80), chip: z.string().min(1).max(40) }),
  z.object({ type: z.literal("alt_pick"), pickerId: z.string().min(1).max(80), productId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("menu_choose"), planId: z.string().min(1).max(80), proposalId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("menu_covers"), planId: z.string().min(1).max(80), covers: z.number().int().min(1).max(5000) }),
  z.object({ type: z.literal("menu_day"), planId: z.string().min(1).max(80), date: z.iso.date() }),
  z.object({ type: z.literal("menu_line_swap"), planId: z.string().min(1).max(80), lineId: z.string().min(1).max(80), optionId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("menu_line_have"), planId: z.string().min(1).max(80), lineId: z.string().min(1).max(80), have: z.boolean() }),
  z.object({ type: z.literal("menu_line_per_cover"), planId: z.string().min(1).max(80), lineId: z.string().min(1).max(80), dishId: z.string().min(1).max(80), amount: z.number().positive().max(100000) }),
  z.object({ type: z.literal("menu_accept"), planId: z.string().min(1).max(80), doubtId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("scenario_answer"), planId: z.string().min(1).max(80), answer: z.union([z.object({ kind: z.literal("yes") }), z.object({ kind: z.literal("no") }), z.object({ kind: z.literal("choose"), optionId: z.string().min(1).max(80) }), z.object({ kind: z.literal("day"), date: z.iso.date() })]) }),
  z.object({ type: z.literal("watch_answer"), momentId: z.string().min(1).max(80), answer: z.string().min(1).max(80) }),
  z.object({ type: z.literal("offer_answer"), offerId: z.string().min(1).max(80), answer: z.enum(["yes", "no", "mute", "off"]) }),
  z.object({ type: z.literal("menu_to_sheet"), planId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("remember_this"), text: z.string().trim().min(2).max(500) }),
  z.object({ type: z.literal("products_search"), query: z.string().max(120), category: z.string().min(1).max(40).optional() }),
  z.object({ type: z.literal("product_show"), productId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("order_again"), ref: z.string().min(1).max(80) }),
  z.object({ type: z.literal("order_show"), orderId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("home_show"), what: z.enum(["history", "standing", "deliveries", "memory", "today"]) }),
  z.object({ type: z.literal("standing_change"), family: z.string().min(1).max(80), packs: z.number().int().min(1).max(9999).optional() }),
  z.object({ type: z.literal("standing_pause"), family: z.string().min(1).max(80), paused: z.boolean() }),
  z.object({ type: z.literal("memory_edit"), itemId: z.string().min(1).max(80), text: z.string().trim().min(2).max(500) }),
  z.object({ type: z.literal("memory_forget"), itemId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("rules_show") }),
  z.object({ type: z.literal("rules_propose"), change: RulesChangeSchema, sign: z.boolean().optional() }),
  z.object({ type: z.literal("rules_sign"), proposalId: z.string().min(1).max(80) }),
  z.object({ type: z.literal("rules_cancel"), proposalId: z.string().min(1).max(80) }),
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
  const e = await engine(rt);
  const t = e.store.get(k.info.slug, k.info.orgId);
  // The kitchen's own store opening the agent on a new day (or an empty thread): the agent speaks first.
  if (k.console && !hasToday(t.turns)) await openToday(k).catch((err) => console.error("[thread] opening", err));
  return e.store.publicView(t);
}

/**
 * The opening (docs/agent-thread.md "The home"): an agent turn with no buyer turn before it, whose one card says
 * what needs the kitchen today, made by plain code from records (home.ts). Its work runs in the background; the card
 * arrives as an event. Nothing is posted twice in a day.
 */
export async function openToday(k: Kitchen): Promise<string | undefined> {
  const r = await resolve(k, "typed");
  const e = await engine(r.rt);
  const thread = e.store.get(r.k.info.slug, r.k.info.orgId);
  if (hasToday(thread.turns)) return undefined;
  const now = new Date().toISOString();
  const opening: AgentTurn = { turnId: newId("trn"), role: "agent", at: now, replyTo: "", status: "working", steps: [], cards: [] };
  // A placeholder card at once, so a second read in the same moment does not open the day twice.
  e.store.addTurn(thread, opening);
  e.store.card(thread, opening.turnId, { type: "today", cardId: todayCardId(thread.threadId), date: helsinkiToday(), items: [], pending: true });
  const buyer: BuyerTurn = { turnId: "", role: "buyer", at: now, door: "typed", via: "tap", label: "Opened the agent" };
  const run: TurnRun = { rt: r.rt, store: e.store, thread, turnId: opening.turnId, buyer, k: r.k, session: r.session, person: r.person, door: "typed", t0: Date.now(), facts: [], requests: new Set(), orders: new Map(), readings: new Map() };
  // Not queued behind (or ahead of) the buyer's turns: it writes only its own card, and a first request typed while
  // the cut-offs are being read must not wait for them.
  void Promise.resolve().then(() =>
    withTurn({ threadId: thread.threadId, turnId: opening.turnId, door: "typed", kitchen: r.k.info.slug, orgId: r.k.info.orgId, agentId: r.session.agentId }, async () => {
      await postToday(run, true);
      e.store.mark(thread, opening.turnId, "done", Date.now() - run.t0);
      e.store.status(thread, opening.turnId, "done", { ms: Date.now() - run.t0 });
    }).catch((err) => {
      console.error("[thread] opening", err);
      e.store.status(thread, opening.turnId, "failed", { ms: Date.now() - run.t0 });
    }),
  );
  return opening.turnId;
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
  const run: TurnRun = { rt: r.rt, store: e.store, thread, turnId: agentTurn.turnId, buyer, k: r.k, session: r.session, person: r.person, door, ...(body.lang ? { lang: body.lang } : {}), t0, facts: [], requests: new Set(), orders: new Map(), readings: new Map() };
  // The first visible sign of work, before any model call.
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, fallbacks: 0, toolCalls: 0 };
  const turnCtx = () => ({ threadId: thread.threadId, turnId: agentTurn.turnId, door, kitchen: slug, orgId: r.k.info.orgId, agentId: r.session.agentId, usage });
  const first = step(run, body.action ? "tap" : "read", !body.action && body.text && worthReading(body.text) ? "Reading your request" : "On it");
  if (!body.action) run.opening = first;

  // A speculative reading of new words, in parallel with the agent's first step (agent.ts asks for the same reading).
  if (body.text && !body.action && worthReading(body.text) && llmRoom()) {
    const fixed = fixTypos(body.text);
    void withTurn(turnCtx(), () => earlierFor(run, fixed).then((earlier) => read(run, fixed, earlier))).catch(() => undefined);
  }

  // One agent turn at a time per thread: a turn sent while one works is answered next.
  // One agent turn at a time per thread (a reset starts a new queue), and never stuck behind one that hangs.
  const queued = e.queues.get(thread.threadId) ?? Promise.resolve();
  const prev = Promise.race([queued, new Promise<void>((r) => setTimeout(r, 20_000))]);
  const next = prev.then(() =>
    withTurn(turnCtx(), () => work(run, body, first)).catch((err) => {
      console.error("[thread]", err);
      e.store.card(thread, agentTurn.turnId, { type: "notice", cardId: cardId("notice", agentTurn.turnId), kind: "error", message: "Something went wrong on our side. Try again.", retry: true });
      e.store.status(thread, agentTurn.turnId, "failed", { ms: Date.now() - t0 });
    }),
  );
  e.queues.set(thread.threadId, next);
  // A watchdog: a turn still working after TURN_MAX_MS (a model or a service that never answers) ends as failed, says
  // what to do, and closes its steps (store.status). If the work finishes later, its own status and cards replace this.
  const watchdog = setTimeout(() => {
    const a = e.store.agentTurn(thread, agentTurn.turnId);
    if (a?.status !== "working") return;
    e.store.card(thread, agentTurn.turnId, { type: "notice", cardId: cardId("notice", `${agentTurn.turnId}:slow`), kind: "unavailable", message: "This is taking too long. Try again in a moment.", retry: true });
    e.store.status(thread, agentTurn.turnId, "failed", { ms: Date.now() - t0 });
  }, TURN_MAX_MS);
  (watchdog as { unref?: () => void }).unref?.();
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
        if (!(await runWidget(run, body.action, body.text))) {
          await checkOpen(run, body.action);
          await runAction(run, body.action, body.text);
        }
      }
    } else if (!llmRoom()) {
      // The day's model cap is reached: say so in one line, and keep ordering possible without a model.
      if (run.opening) first.skip("paused for today");
      await paused(run);
    } else {
      try {
        // "Switch auto-renew on for the milk": done by plain code (server/watch), said in the store's own words.
        const { autoRenewFromWords } = await import("./watch");
        const auto = await autoRenewFromWords(run, body.text!).catch(() => undefined);
        if (auto) {
          if (run.opening) first.done("auto-renew");
          store.line(thread, run.turnId, auto);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
        agentResult = await agentTurn(run, body.text!);
      } catch (err) {
        if (!(err instanceof DockError) || !PAUSED_CODES.has(err.code)) throw err;
        await paused(run);
      }
      if (run.opening) first.done(); // no reading was needed (a reply to a card, a question)
    }
    line = agentResult?.text ?? "";
  } catch (err) {
    if (!(err instanceof DockError)) throw err;
    if (run.opening) first.done();
    store.card(thread, run.turnId, { type: "notice", cardId: cardId("notice", run.turnId), kind: err.code === "turn_card_stale" ? "refused" : err.status === 429 || err.status === 503 ? "unavailable" : "refused", message: err.message, ...(err.rule ? { rule: err.rule } : {}), retry: err.status >= 500 || err.status === 429 });
  }

  // A tap that left an order waiting for a person: the agent loop takes up the wait (the runtime's approval step).
  // A tap (a choice, the OK, taking an order back) is answered in words too: the agent writes its sentences from
  // what the tap produced (speak.ts facts), in the buyer's language, under the same grounding check.
  if (!agentResult && body.action && run.store.agentTurn(thread, run.turnId)?.status === "working" && llmRoom()) {
    const pending = [...run.orders.values()].find((o) => o.status === "pending_approval");
    const shown = JSON.stringify(speakFacts(run)).slice(0, 5000);
    const lang = body.lang === "fi" ? "Finnish" : body.lang === "sv" ? "Swedish" : "English";
    const nudge = pending
      ? `[The buyer tapped "${(body.label ?? body.action.type).slice(0, 120)}". The order ${pending.orderId} now waits for ${pending.approval?.approver.name ?? "a person"}'s OK. What the store shows now: ${shown}. Call await_sign_off for it, then write your sentences in ${lang}.]`
      : `[The buyer tapped "${(body.label ?? body.action.type).slice(0, 120)}". What the store shows now: ${shown}. Write your two to four sentences about it in ${lang}; call no tool.]`;
    agentResult = await agentTurn(run, undefined, nudge).catch(() => undefined);
    line = agentResult?.text ?? "";
  }

  // The wholesaler's offer the buyer asked for: its own words (plain code, from the signed offer) are the reply.
  const lang = body.lang ?? "en";
  if (run.scenarioSaid) {
    const c = store.cards(thread).map((x) => x.card).find((x) => x.type === "scenario" && x.cardId === run.scenarioSaid);
    if (c?.type === "scenario" && c.state === "open") {
      store.line(thread, run.turnId, `${c.text[lang].say} ${c.text[lang].ask}`);
      store.mark(thread, run.turnId, "line", Date.now() - run.t0);
      line = "";
    }
  }
  if (run.watchAsked) {
    const c = store.cards(thread).map((x) => x.card).find((x) => x.type === "watch" && x.momentId === run.watchAsked);
    if (c?.type === "watch") {
      store.line(thread, run.turnId, `${c.text[lang].say}${c.text[lang].ask ? ` ${c.text[lang].ask}` : ""}`);
      store.mark(thread, run.turnId, "line", Date.now() - run.t0);
      line = "";
    }
  }
  if (run.offerAsked) {
    const c = store.cards(thread).map((x) => x.card).find((x) => x.type === "offer" && x.offerId === run.offerAsked);
    if (c?.type === "offer") {
      store.line(thread, run.turnId, `${c.text[lang].say} ${c.text[lang].ask}`);
      store.mark(thread, run.turnId, "line", Date.now() - run.t0);
      line = "";
    }
  }
  if (line) await showLine(run, line);
  // An order that went straight to a person's OK, with no words from the agent: what, how much and why, in one sentence.
  const sent = store.agentTurn(thread, run.turnId);
  const gateHere = sent?.cards.find((c) => c.type === "gate" && c.outcome === "waiting");
  if (sent && !sent.line && gateHere?.type === "gate") {
    const order = sent.cards.find((c) => c.type === "order" && c.orderId === gateHere.orderId);
    if (order?.type === "order") store.line(thread, run.turnId, waitingSentence(order, gateHere, body.lang ?? "en"));
  }
  // Never an empty reply: when the agent's words did not come (or none were backed), plain words from what the engine knows.
  const after = store.agentTurn(thread, run.turnId);
  if (after && !after.line && !after.cards.some((c) => c.type !== "understood")) {
    const l = body.lang ?? "en";
    const waitingCard = store.cards(thread).map((x) => x.card).find((c) => c.type === "gate" && c.outcome === "waiting");
    const who = waitingCard?.type === "gate" ? (waitingCard.approver?.name ?? "") : "";
    const text = waitingCard
      ? { en: `Your order still waits for ${who || "a person"}'s OK on their phone; only their own OK places it. Anything else I can do?`, fi: `Tilauksesi odottaa yhä hyväksyntää${who ? ` (${who})` : ""} puhelimella; vain se hyväksyntä tekee tilauksen. Voinko auttaa muuten?`, sv: `Din beställning väntar fortfarande på godkännande${who ? ` av ${who}` : ""} i telefonen; bara det godkännandet lägger den. Något annat jag kan göra?` }[l]
      : { en: "I didn't manage to act on that. Could you say it another way?", fi: "En saanut tästä kiinni. Voisitko sanoa sen toisin?", sv: "Jag fick inte grepp om det. Kan du säga det på ett annat sätt?" }[l];
    store.line(thread, run.turnId, text);
    record(run, "empty_reply", "The agent's turn had no words: the engine's plain sentence was said instead.", {});
  }
  // An order finished in this turn (placed, nothing waiting): the moment for the wholesaler's one offer, if any.
  const mine = store.agentTurn(thread, run.turnId);
  if (!run.offerAsked && mine?.cards.some((c) => c.type === "order" && c.status === "committed") && !mine.cards.some((c) => c.type === "gate" && c.outcome === "waiting")) {
    const { sayOffer } = await import("./offer");
    await sayOffer(run).catch(() => undefined);
  }
  await finishTurn(run);
}

/**
 * The reply as the buyer reads it: English days as people write them ("Monday 16 Nov"); a date's own dot never followed
 * by the sentence's punctuation; and no code (a category code, a product id, a rule or reason code, a snake_case word)
 * in any sentence: a sentence carrying one is dropped, and if none is left, the refusal's own words (refusal.ts) stand.
 */
function plainLine(run: TurnRun, text: string): string {
  const lang = /\b(maanantai|tiistai|keskiviikko|torstai|perjantai|lauantai|sunnuntai)\w*|[äö]/i.test(text) ? "fi" : /\b(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b|å/i.test(text) ? "sv" : "en";
  let t = text.replace(/(\d{1,2}\.\d{1,2}\.)(\}\}|\*\*)?\./g, "$1$2");
  if (lang === "en") {
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // The date's own dot also ended the sentence ("... Monday 16.11." or "16.11. Shall I"): the sentence keeps its full stop.
    t = englishDays(t);
    t = t.replace(/\{\{(\d{1,2})\.(\d{1,2})\.?\}\}/g, (m, d: string, mo: string) => (Number(mo) >= 1 && Number(mo) <= 12 ? `{{${Number(d)} ${MON[Number(mo) - 1]}}}` : m));
  }
  // Catalogue jargon: a "novobox" is a 10 l box to a person.
  t = t.replace(/\bnovobox(?:ia|in|issa|eja|ista|ille|eihin)?\b/gi, (m) => (lang === "fi" ? (/ia$/i.test(m) ? "laatikkoa" : "laatikko") : lang === "sv" ? "låda" : "box"));
  // "16.11.?" reads badly: the sentence's own mark replaces the date's dot.
  t = t.replace(/(\d{1,2}\.\d{1,2})\.(\}\}|\*\*)?(?=[?;:,!])/g, "$1$2");
  // Never a set phrase for the buyer to type, never how the system works inside: such a sentence is dropped.
  const plainOnes = t.split(/(?<=[.!?])\s+/).filter((x) => !insideOrTell(x));
  if (plainOnes.length && plainOnes.length < t.split(/(?<=[.!?])\s+/).length) {
    record(run, "inside_words", "Sentences that told the buyer what to type, or how the system works inside, were not shown.", { said: t });
    t = plainOnes.join(" ");
  }
  const leaks = codeLeaks(t.replace(/\*\*|\{\{|\}\}/g, ""));
  if (!leaks.length) return t;
  const kept = t.split(/(?<=[.!?])\s+/).filter((x) => !codeLeaks(x.replace(/\*\*|\{\{|\}\}/g, "")).length);
  record(run, "code_in_reply", `Sentences of the agent's reply were not shown: they carried ${leaks.slice(0, 5).join(", ")}.`, { leaks });
  if (kept.length) return kept.join(" ");
  const said = run.store.agentTurn(run.thread, run.turnId)?.cards.flatMap((c) => ((c.type === "notice" || c.type === "gate") && c.said ? [c.said] : [])).at(-1);
  return said ? said[lang] : "";
}

/** "1 000 × Valio Eila 1 l for 1 010,00 € is over the 500,00 € I may spend alone, so it needs the kitchen manager's OK." */
function waitingSentence(order: OrderCard, gate: GateCard, lang: "en" | "fi" | "sv"): string {
  const eur = (c: number) => `**${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €**`;
  const first = order.lines[0];
  const what = first ? `${first.quantity} × ${first.name.replace(/[®™]/g, "").split(/\s+/).slice(0, 4).join(" ")}${order.lines.length > 1 ? (lang === "fi" ? ` ja ${order.lines.length - 1} muuta` : lang === "sv" ? ` och ${order.lines.length - 1} till` : ` and ${order.lines.length - 1} more`) : ""}` : "";
  const limit = gate.rules?.find((r) => r.rule === "per_order_limit")?.details?.limitCents;
  const who = gate.approver?.name ?? (lang === "fi" ? "vastuuhenkilö" : lang === "sv" ? "en ansvarig" : "a person");
  const whoEn = /^[A-Z][a-z]+ [a-z]/.test(who) ? `the ${who.toLowerCase()}` : who;
  if (lang === "fi") return `${what} hintaan ${eur(order.totalCents)}${typeof limit === "number" ? ` ylittää ${eur(limit)}, jonka voin käyttää yksin, joten` : ", joten"} se tarvitsee hyväksynnän: ${who}.`;
  if (lang === "sv") return `${what} för ${eur(order.totalCents)}${typeof limit === "number" ? ` är över de ${eur(limit)} jag får handla för själv, så` : ", så"} det behöver godkännas av ${who}.`;
  return `${what} for ${eur(order.totalCents)}${typeof limit === "number" ? ` is over the ${eur(limit)} I may spend alone, so it` : " needs a person's check, so it"} needs ${whoEn}'s OK.`;
}

/** The end of an agent turn: what to remember, its status (waiting for the buyer, for a person, or done) and the record. */
async function finishTurn(run: TurnRun): Promise<void> {
  const { store, thread } = run;
  const a = store.agentTurn(thread, run.turnId)!;
  const waitingApprover = a.cards.some((c) => c.type === "gate" && c.outcome === "waiting");
  const waitingBuyer = !waitingApprover && a.cards.some((c) => (c.type === "anomaly" && !c.answered) || c.type === "question" || (c.type === "options" && !c.chosen) || (c.type === "menu" && !c.sheetId && (c.stage === "choose" || c.stage === "ready")) || (c.type === "price" && !a.cards.some((x) => x.type === "gate" && x.requestId === c.requestId)));
  store.mark(thread, run.turnId, "done", Date.now() - run.t0);
  store.status(thread, run.turnId, waitingApprover ? "waiting_approver" : waitingBuyer ? "waiting_buyer" : "done", { ms: Date.now() - run.t0, marks: a.marks });
  record(run, "turn_done", `Agent turn finished (${a.status}) in ${Date.now() - run.t0} ms: ${a.cards.map((c) => c.type).join(", ") || "no cards"}.`, { status: a.status, marks: a.marks, cards: a.cards.map((c) => c.type), requests: [...run.requests], orders: [...run.orders.keys()] });
  // What to remember comes after: the memory writer reads the order with a model, and nothing waits for it.
  await proposeMemory(run);
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

const PAUSED_CODES = new Set(["demo_limit_reached", "llm_disabled"]);

/**
 * The agent's reading is paused for today (the server's daily model cap, server/limits.ts): one line saying so, and
 * what still works without a model, as one-tap repeats of the kitchen's recent orders (each a `repeat` action, rebuilt
 * by plain code and sent through the same intake and gate). The catalogue, the basket and standing orders work as
 * ever; the notice names them.
 */
async function paused(run: TurnRun): Promise<void> {
  run.store.card(run.thread, run.turnId, { type: "notice", cardId: cardId("notice", `${run.turnId}:paused`), kind: "paused", message: "The agent's reading is paused for today on this server. You can still order: repeat an earlier order below, or use the catalogue and the basket. Everything still goes through the gate." });
  record(run, "paused", "The day's model cap is reached: the agent did not read the words; ordering without a model was offered.", {});
  try {
    const { overview } = await import("@/server/kitchen-portal");
    const ov = await overview(run.k);
    const seen = new Set<string>();
    const rows: RecordsCard["rows"] = [];
    for (const r of ov.requests) {
      const label = r.order?.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ");
      if (!r.order || !label || seen.has(label)) continue;
      seen.add(label);
      rows.push({ kind: "order", label, totalCents: r.order.totalCents, date: r.order.deliveryDate, ref: r.requestId ?? r.key });
      if (rows.length >= 5) break;
    }
    if (rows.length) run.store.card(run.thread, run.turnId, { type: "records", cardId: cardId("records", `${run.turnId}:paused`), question: "", rows, repeatable: true });
  } catch {
    // the notice alone still says what works
  }
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
  return settled(
    messages.slice(start).flatMap((m): ModelMessage[] => {
      if (m.role !== "assistant" || typeof m.content === "string") return [m];
      const content = m.content.filter((p) => p.type !== "reasoning");
      return content.length ? [{ ...m, content }] : [];
    }),
  );
}

/**
 * History a new turn can be sent with: every tool call answered. A paused approval (await_sign_off) leaves a call
 * whose result lives only in the resumed run, or nowhere if the sign-off came another way; the provider then refuses
 * the whole conversation (missing tool result). Approval requests and responses of finished pauses are dropped, and a
 * call still without a result gets one saying it is settled outside the conversation: its cards say how.
 */
export function settled(messages: ModelMessage[]): ModelMessage[] {
  const answered = new Set<string>();
  for (const m of messages) if (m.role === "tool") for (const p of m.content) if (p.type === "tool-result") answered.add(p.toolCallId);
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const content = m.content.filter((p) => p.type === "tool-result");
      if (content.length) out.push({ ...m, content });
      continue;
    }
    if (m.role !== "assistant" || typeof m.content === "string") {
      out.push(m);
      continue;
    }
    const content = m.content.filter((p) => p.type !== "tool-approval-request");
    if (!content.length) continue;
    out.push({ ...m, content });
    const open = content.filter((p): p is Extract<typeof p, { type: "tool-call" }> => p.type === "tool-call" && !answered.has(p.toolCallId));
    if (open.length) out.push({ role: "tool", content: open.map((p) => ({ type: "tool-result" as const, toolCallId: p.toolCallId, toolName: p.toolName, output: { type: "text" as const, value: "Settled outside this conversation step: the cards show the outcome." } })) });
  }
  return out;
}

/**
 * The model's sentence, shown only if every figure, date, product and claim in it is in the data the buyer has in
 * front of them: this turn's tool results and cards, and the records of the requests still on screen (a follow-up
 * question about the options shown a turn ago is answered from those options).
 */
async function showLine(run: TurnRun, text: string): Promise<void> {
  // Two to four sentences, with the agent's two marks (**figure**, {{day}}) kept for display and stripped for the check.
  // Checked as the model wrote it (its dates as "16.11."); worded for the buyer after (plainLine: English days, no codes).
  const one = text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, 600).replace(/(\d{1,2}\.\d{1,2}\.)(\}\}|\*\*)?\./g, "$1$2");
  if (!one) return;
  // For the check, an English day "18 Nov" is read as the date it is ("18.11.").
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const plain = one
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\{\{([^}]+)\}\}/g, "$1")
    .replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/g, (_m, d: string, mo: string) => `${d}.${MONTHS.indexOf(mo.toLowerCase()) + 1}.`)
    // A time "17.00" (no month 00 or above 12) at a sentence's end is a time, not a date "17.00.".
    .replace(/\b([01]?\d|2[0-3])\.([0-5]\d)(?=\.?(?:\s|$|[,;?!]))/g, (m, h: string, mm: string) => (mm === "00" || Number(mm) > 12 ? `${h}:${mm}` : m));
  // Under 60 words: whole sentences from the start while they fit, and a closing question kept (it is what is open).
  const words = (x: string) => x.replace(/\*\*|\{\{|\}\}/g, "").split(/\s+/).filter(Boolean).length;
  if (words(one) > 60) {
    const parts = one.split(/(?<=[.!?])\s+(?=[\p{Lu}"“*{])/u);
    const last = parts.at(-1)!.trim().endsWith("?") ? parts.at(-1)! : undefined;
    const keep: string[] = [];
    for (const p of parts.slice(0, last ? -1 : undefined)) if (words([...keep, p, last ?? ""].join(" ")) <= 60) keep.push(p);
    const short = [...keep, ...(last ? [last] : [])].join(" ").replace(/\s+/g, " ").trim();
    if (short) return showLine(run, short);
  }
  const onScreen = [...new Set(run.store.cards(run.thread).flatMap((x) => ("requestId" in x.card && x.card.requestId ? [x.card.requestId] : [])))].slice(-3);
  const steps = await Promise.all(onScreen.map((id) => run.rt.dock.intake.get(run.session, id).catch(() => undefined)));
  const facts = addWords(factsFrom(...run.facts, ...steps.filter(Boolean), run.store.cards(run.thread).slice(-12).map((x) => x.card)), run.buyer.text ?? "");
  const g = groundForDisplay("thread", plain, facts, { where: `thread ${run.thread.threadId}`, replacement: "" });
  if (g.violations.length) {
    record(run, "grounding_refusal", `A sentence of the agent's reply was not shown: it said ${g.violations.map((v) => `"${v.said}" (${v.kind})`).join(", ")}, which the data does not back.`, { said: one, violations: g.violations });
    // Only the sentences the data backs are shown (without marks); none at all when none is backed.
    const kept = plainLine(run, g.text.replace(/\s+/g, " ").trim());
    if (!kept || g.replaced >= g.sentences) return;
    run.store.line(run.thread, run.turnId, kept);
    run.store.mark(run.thread, run.turnId, "line", Date.now() - run.t0);
    return;
  }
  const shown = plainLine(run, one);
  if (!shown) return;
  run.store.line(run.thread, run.turnId, shown);
  run.store.mark(run.thread, run.turnId, "line", Date.now() - run.t0);
}



/** How long the turn shows the memory step as working before it lets the writer finish out of sight. */
const MEMORY_STEP_WAIT_MS = 6_000;
/** Longer than the slowest real turn (a menu planned from words, about 40 s; a model fallback adds a few). */
const TURN_MAX_MS = 150_000;

/** After an order: what the memory writer proposes to remember, for the kitchen's person to keep or drop. */
async function proposeMemory(run: TurnRun): Promise<void> {
  const orders = [...run.orders.values()].filter((o) => o.status === "committed" || o.status === "pending_approval");
  if (!orders.length || process.env.DOCK_MEMORY === "off") return;
  // Memory is a help, never a blocker, and must never look like one. Its step is always closed: when the writer
  // finishes, when it fails, and after a few seconds if it is still reading (it then finishes behind the scenes
  // and its card appears when it is ready). A buyer once saw "Noting what to remember" spin for ever, because a
  // slow or failed model call left the step open.
  let st: ReturnType<typeof step> | undefined;
  let closed = false;
  const close = (how: "done" | "skip", detail?: string) => {
    if (closed || !st) return;
    closed = true;
    if (how === "done") st.done(detail);
    else st.skip(detail);
  };
  const work = (async () => {
    const { getMemoryService } = await import("@/server/memory/runtime");
    const memory = await getMemoryService();
    st = step(run, "memory", "Noting what to remember");
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
    close("done", `${proposals.length}`);
    if (proposals.length || used.length) run.store.card(run.thread, run.turnId, { type: "memory", cardId: cardId("memory", run.turnId), used: [...new Set(used)], proposals: proposals.slice(0, 3) });
  })().catch(() => close("skip"));
  await Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, MEMORY_STEP_WAIT_MS))]);
  close("skip");
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
      // The words said before the OK stay; what happened after it is said beneath them, never in their place.
      const before = e.store.agentTurn(t, wait.turnId)?.line ?? "";
      if (res.text) await showLine(run, res.text);
      const after = e.store.agentTurn(t, wait.turnId)?.line ?? "";
      if (before && after && after !== before && !after.startsWith(before)) e.store.line(t, wait.turnId, `${before}\n${after}`);
    } catch {
      // the cards already show the outcome
    }
    e.store.status(t, wait.turnId, "done", { ms: holder.ms });
    e.store.save(t);
  });
}

export type { ItemOutcome };
