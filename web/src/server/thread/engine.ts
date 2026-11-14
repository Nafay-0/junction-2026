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
import { byLine, checkOpen, read, record, runAction, step, type ItemOutcome, type TurnRun } from "./pipeline";
import { earlierFor } from "./earlier";
import { ThreadStore, type StoredThread } from "./store";
import { runWidget } from "./widgets";
import { speakFacts } from "./speak";
import { codeLeaks, englishDays, insideOrTell } from "./refusal";
import { fmtFor, gateReasons } from "@/app/k/[kitchen]/thread-words";
import { THREAD_WORDS } from "@/app/k/[kitchen]/thread-words.text";
import { changeLines, groupNameL } from "@/app/k/[kitchen]/rules-change";
import { fixTypos } from "./pipeline";
import { hasToday, helsinkiToday, postToday, todayCardId } from "./home";
import { ensureTelemetry } from "./telemetry";
import { failureOf, turnOutcome, type TurnFailure } from "./outcome";
import type { AgentTurn, BuyerTurn, Card, GateCard, MemoryCard, MenuCard, OrderCard, RecordsCard, RulesCard, SubmitTurn, SubmitTurnReply, ThreadAction, ThreadDoor } from "./types";

type RulesDiff = RulesCard["diff"];

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
  autoRenewOn: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(4).optional(),
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
      turnFailed(run, failureOf(err));
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
  if (body.text && !body.action && worthReading(body.text) && llmRoom() && !/@/.test(body.text)) {
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
      turnFailed(run, failureOf(err));
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
    // Nearly always a model that never answers (tools have their own, shorter limits).
    turnFailed(run, "model_timeout");
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
  // An email address the buyer types never goes into the record (or the steps, or telemetry): masked.
  const masked = (body.text ?? "").replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, (m) => `${m[0]}•••@${m.split("@")[1]}`);
  record(run, "turn", body.action ? `The buyer tapped "${body.label ?? body.action.type}" (${run.door}).` : `The buyer said (${run.door}): "${masked.slice(0, 300)}"`, { via: body.via, ...(body.text ? { words: masked.slice(0, 2000) } : {}), ...(body.action ? { action: body.action } : {}) });
  let line = "";
  let agentResult: AgentRunResult | undefined;
  // An answer in words to the menu scenario on the table ("Monday is fine", "sounds good", "use the beef cubes"): read by
  // the adapter (scenarioAnswerOf), the same as the tap. Its plan stays the subject after the first answer, so naming
  // another verified option still reaches it.
  if (!body.action && body.text) {
    const sc = run.store.cards(thread).map((x) => x.card).filter((c) => c.type === "scenario").at(-1);
    const lastReply = [...thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
    const recent = sc && lastReply?.role === "agent" && (lastReply.cards.some((c) => c.cardId === sc.cardId) || thread.turns.slice(thread.turns.findIndex((x) => x.role === "agent" && x.cards.some((c) => c.cardId === sc.cardId))).filter((x) => x.role === "buyer").length <= 3);
    if (sc?.type === "scenario" && recent) {
      const { scenarioAnswerOf } = await import("@/server/agent/menu/thread");
      const a = scenarioAnswerOf(body.text, sc.pending as never);
      if (a && (sc.state === "open" || a.kind === "choose")) {
        if (sc.state !== "open") run.store.card(thread, run.turnId, { ...sc, state: "open" });
        body = { ...body, action: { type: "scenario_answer", planId: sc.planId, answer: a }, label: body.text };
      }
    }
  }
  // "Yes" to "Shall I leave the chocolate out?" (a line the kitchen's allergen rule stops): that line is left off.
  const leaveOut = (thread as unknown as { leaveOut?: { planId: string; lineId: string } }).leaveOut;
  if (leaveOut && !body.action && body.text && body.text.trim().split(/\s+/).length <= 6) {
    const { yesOrNo } = await import("@/server/channels/speech");
    const last = [...thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
    if (last?.role === "agent" && /(leave the .+ out\?|jätänkö sen pois|ska jag utelämna)/i.test(last.line ?? "") && yesOrNo(body.text) === "yes") {
      body = { ...body, action: { type: "menu_line_have", planId: leaveOut.planId, lineId: leaveOut.lineId, have: true }, label: body.text };
      const left = ((thread as unknown as { leftOff?: Record<string, string[]> }).leftOff ??= {});
      left[leaveOut.planId] = [...(left[leaveOut.planId] ?? []), leaveOut.lineId];
      delete (thread as unknown as { leaveOut?: unknown }).leaveOut;
      run.dishesFor = { planId: leaveOut.planId, changed: true };
    }
  }
  // "Yes" to "That needs the owner's OK with their passkey: shall I send it to them?": the drafted change goes to the
  // signer (rules_sign makes it wait for their passkey; a typed yes never signs a widening).
  if (!body.action && body.text && body.text.trim().split(/\s+/).length <= 6) {
    const { yesOrNo } = await import("@/server/channels/speech");
    const last = [...thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
    const open = last?.role === "agent" ? last.cards.find((c) => c.type === "rules" && c.proposal?.state === "open") : undefined;
    if (open?.type === "rules" && open.proposal && /(shall I send it to them\?|lähetänkö sen\?|ska jag skicka den\?)/i.test(last?.role === "agent" ? (last.line ?? "") : "") && yesOrNo(body.text) === "yes") body = { ...body, action: { type: "rules_sign", proposalId: open.proposal.proposalId }, label: body.text };
  }
  // An answer to the ways forward for a dish not fully buyable: ask the owner to add the groups, order just what can be
  // bought (each left-off ingredient was said before), or anything else (another dish) for the agent.
  const ways = waysOf(run).ways;
  if (ways && !body.action && body.text && body.text.trim().split(/\s+/).length <= 12) {
    const { yesOrNo } = await import("@/server/channels/speech");
    const last = [...thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
    if (last?.role === "agent" && /(plan a dish I can buy completely|plan another dish|suunnittelenko ruuan|suunnittelenko toisen|planera en rätt|planera en annan)/i.test(last.line ?? "")) {
      const t = body.text;
      const yn = yesOrNo(t);
      if (ways.owner && /\b(owner|ask|add them|add the|omistaj\w*|lisää\w*|pyydä\w*|ägaren|lägg till|be )\b/i.test(t)) run.waysAnswer = "owner";
      else if (/\b(just|only|those|the rest|what you can|order them|vain|ne|bara|resten)\b/i.test(t) || (yn === "yes" && !ways.owner)) {
        body = { ...body, action: { type: "menu_to_sheet", planId: ways.planId }, label: body.text };
        run.placedPlan = ways.planId;
        delete waysOf(run).ways;
      } else if (yn === "yes") run.waysAnswer = "which";
    }
  }
  // "Yes" to "Shall I order it?" for the menu on the table: ordered (the same as its order button, then the gate).
  if (!body.action && !run.waysAnswer && body.text && body.text.trim().split(/\s+/).length <= 6) {
    const { yesOrNo } = await import("@/server/channels/speech");
    const last = [...thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
    const asked = last?.role === "agent" && /(shall i order|tilaanko|ska jag beställa)/i.test(last.line ?? "");
    const { openMenu } = await import("./menu");
    const m = openMenu(run);
    if (asked && yesOrNo(body.text) === "yes" && m?.stage === "ready" && m.totalCents > 0 && !m.blockers.length) {
      body = { ...body, action: { type: "menu_to_sheet", planId: m.planId }, label: body.text };
      run.placedPlan = m.planId;
      // The day agreed is the day ordered: the day the question named, not another one.
      const day = dayIn((last?.role === "agent" ? (last.line ?? "") : "").split(/(?<=[.!?])\s+/).filter((x) => /\?\s*$/.test(x)).at(-1) ?? "");
      if (day) run.orderDay = day;
    }
  }
  // An answer in words to the mistake check just said ("yes, 1 000", "100", "it's for an event"): the same as the tap,
  // and a reason the buyer gives is recorded as theirs.
  if (!body.action && body.text) {
    const last = [...thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
    const open = last?.role === "agent" ? last.cards.find((c) => c.type === "anomaly" && !c.answered) : undefined;
    if (open?.type === "anomaly") {
      const { guardAnswerOf, guardWords } = await import("./guard");
      // "Which order?": the check's own words again, which name the order (what, how much, when, for which day).
      if (/\b(which (order|one)|what order|mikä tilaus|mikä niistä|vilken (order|beställning))\b/i.test(body.text)) run.sayNow = whichOrder(run, open, body.lang ?? "en") ?? guardWords(open, body.lang ?? "en");
      const a = run.sayNow ? undefined : guardAnswerOf(open, body.text);
      if (a) {
        if (a.reason) record(run, "buyer_reason", `The buyer kept the amount as asked, with a reason: "${a.reason}".`, { reason: a.reason, key: open.concerns[0]?.key }, open.requestId);
        body = { ...body, action: a.action, label: body.text };
      }
    }
  }
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
        } else if (body.action.type === "menu_to_sheet" && body.via !== "tap") {
          // "Yes" to "Shall I order it?" for the menu on the table: onto one order sheet, and that sheet through the gate.
          const { currentSheet, placeSheet } = await import("./sheet");
          // Only the sheet this yes just made: a menu held back (a difference not yet said) places nothing.
          const sh = currentSheet(run);
          const made = sh && store.agentTurn(thread, run.turnId)?.cards.some((c) => c.type === "sheet" && c.sheetId === sh.sheetId);
          if (sh && made) await placeSheet(run, sh.sheetId, sh.version);
        }
      }
    } else if (!llmRoom()) {
      // The day's model cap is reached: say so in one line, and keep ordering possible without a model.
      if (run.opening) first.skip("paused for today");
      await paused(run);
    } else {
      try {
        // Words about the order emails ("email receipts to chef@…", "stop the emails", "which address?"): plain code,
        // never the model, never the reader (server/notify/thread.ts).
        const { mailWordsOf, answerMailWords } = await import("@/server/notify/thread");
        const mail = mailWordsOf(body.text!);
        if (mail) {
          const r = await answerMailWords(run.rt, run.k, mail, { person: run.person, via: "thread", lang: body.lang ?? "en" });
          if (run.opening) first.done("email");
          store.line(thread, run.turnId, r.reply);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
        // A short answer to the backup question just said ("you choose", "the second one", "no"): recorded, nothing bought.
        const backedUp = await (await import("./backup")).answerBackupIn(run, body.text!, body.lang ?? "en").catch((err) => {
          console.error("[thread] backup answer", err);
          return undefined;
        });
        if (backedUp) {
          if (run.opening) first.done("answered the backup");
          // The mail clause that waited behind the backup question follows the answer.
          const bk = [...thread.turns].reverse().flatMap((x) => (x.role === "agent" ? x.cards : [])).find((c) => c.type === "backup" && c.orderId);
          const ord = bk?.type === "backup" && bk.orderId ? store.cards(thread).map((x) => x.card).find((c) => c.type === "order" && c.orderId === bk.orderId) : undefined;
          const { mailFactAfterOrder } = await import("@/server/notify/thread");
          const mailFact = ord?.type === "order" ? await mailFactAfterOrder(run.rt, run.k, { orderId: ord.orderId, status: ord.status }, { lang: body.lang ?? "en", threadId: thread.threadId }).catch(() => undefined) : undefined;
          store.line(thread, run.turnId, mailFact ? `${backedUp} ${mailFact}` : backedUp);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
        // A sentence plain code already has for these words (the mistake check's own words, asked again).
        if (run.sayNow) {
          if (run.opening) first.done();
          store.line(thread, run.turnId, run.sayNow);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
        // The answer to the ways forward: the owner asked (a drafted change to the kitchen's product groups), or which one.
        if (run.waysAnswer) {
          const said = run.waysAnswer === "owner" ? await askOwnerToAdd(run, body.lang ?? "en") : { en: "Which one: ask the owner to add them, order just what I can buy, or plan another dish?", fi: "Kumpi: pyydänkö omistajaa lisäämään ne, tilaanko vain sen, minkä voin ostaa, vai suunnittelenko toisen ruuan?", sv: "Vilket: ska jag be ägaren lägga till dem, beställa bara det jag kan köpa, eller planera en annan rätt?" }[body.lang ?? "en"];
          if (run.opening) first.done();
          store.line(thread, run.turnId, said);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
        // Planning a dish: one question for an open request, the ideas, the pick (dish.ts), by plain code and the planner.
        const dish = await import("./dish").then((d) => d.dishTurn(run, body.text!, body.lang ?? "en")).catch((err) => {
          console.error("[thread] dish", err);
          return undefined;
        });
        if (dish) {
          if (run.opening) first.done("planning a dish");
          store.line(thread, run.turnId, dish);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
        // A change in words to the menu on the table ("make it lactose-free", "no nuts", "for 20", "drop the soup"):
        // the menu adapter changes the plan and says what changed and the new total (server/agent/menu/thread.ts).
        const changed = await changeMenuInWords(run, body.text!, body.lang ?? "en").catch((err) => {
          console.error("[thread] change menu", err);
          return undefined;
        });
        if (changed) {
          if (run.opening) first.done("changed the menu");
          store.line(thread, run.turnId, changed);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
        // "Yes" to drafting a change to the kitchen's rules (a refusal that offered it): the change drafted as a proposal
        // the kitchen's own person confirms with a yes (rules.ts, the account's own terms), then the buy is offered again.
        const drafted = await draftRulesChange(run, body.text!, body.lang ?? "en").catch((err) => {
          console.error("[thread] draft rules", err);
          return undefined;
        });
        if (drafted) {
          if (run.opening) first.done("drafted the change");
          store.line(thread, run.turnId, drafted);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
        // A short answer to the wholesaler's offer said just before ("no thanks", "not now", "ei kiitos", "yes please"):
        // recorded by plain code, never left to the model to remember.
        const offered = await answerOpenOffer(run, body.text!, body.lang ?? "en").catch(() => undefined);
        if (offered) {
          if (run.opening) first.done("answered the offer");
          store.line(thread, run.turnId, offered);
          store.mark(thread, run.turnId, "line", Date.now() - run.t0);
          await finishTurn(run);
          return;
        }
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
        // "Yes" after the kitchen's rules were changed to allow a product: the buy that was refused, now asked again.
        const again = afterRulesWords(run, body.text!);
        if (again) record(run, "after_rules", `The rules now allow it: the earlier request "${again.slice(0, 80)}" is asked again at the buyer's yes.`, {});
        agentResult = await agentTurn(run, again ?? body.text!);
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
    // The agent's model failed: the buyer gets the notice (and can try again), the scorecard a failed turn.
    if (err.code === "agent_unavailable") turnFailed(run, failureOf(err));
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
  // A menu planned this turn with a dish the kitchen's rules refuse: the planner's own checks say it, by name, with
  // what can be made instead and the question (server/agent/menu/thread.ts menuChecks), never the model's guess.
  const menuHere = store.agentTurn(thread, run.turnId)?.cards.find((c) => c.type === "menu" && c.planId);
  if (menuHere?.type === "menu" && menuHere.stage !== "declined") {
    const { menuChecks } = await import("@/server/agent/menu/thread");
    const m = await menuChecks(run.k.info.slug, menuHere.planId, body.lang ?? "en").catch(() => undefined);
    if (m?.refusedDish && m.say) {
      store.line(thread, run.turnId, `${m.say}${m.ask ? ` ${m.ask}` : ""}`);
      record(run, "dish_refused", `The planner refused a dish under the kitchen's rule: ${m.say.slice(0, 160)}`, { planId: menuHere.planId });
    }
  }
  // The mistake check paused this request: the sentence is the finding's own comparison, both figures, and one question.
  const guardCard = store.agentTurn(thread, run.turnId)?.cards.find((c) => c.type === "anomaly" && !c.answered);
  if (guardCard?.type === "anomaly") {
    const { guardWords } = await import("./guard");
    const said = guardWords(guardCard, body.lang ?? "en");
    if (said) store.line(thread, run.turnId, said);
  }
  // An order the gate refused in this turn: the refusal's own words (the rule, the product, the next step), always.
  const refusedHere = store.agentTurn(thread, run.turnId)?.cards.find((c) => c.type === "gate" && c.outcome === "refused" && c.said);
  if (refusedHere?.type === "gate" && refusedHere.said) store.line(thread, run.turnId, refusedHere.said[body.lang ?? "en"]);
  // An order that went straight to a person's OK, with no words from the agent: what, how much and why, in one sentence.
  const sent = store.agentTurn(thread, run.turnId);
  const gateHere = sent?.cards.find((c) => c.type === "gate" && c.outcome === "waiting");
  // "Ignore the limit", "the manager already said yes": the order still needs the manager's own OK, on their device.
  const PRESSURE = /\b(ignore|skip|override|bypass|forget)\b[^.?!]{0,30}\b(limit|rules?|approval|sign-?off)\b|\b(already (said yes|approved|agreed|ok'?d|signed))\b|ohita|älä välitä|jo hyväksy|redan godkänt/i;
  const pressed = run.thread.turns.slice(-8).some((x) => x.role === "buyer" && !!x.text && PRESSURE.test(x.text));
  if (gateHere?.type === "gate" && pressed && !gateHere.pressured) {
    store.card(thread, run.turnId, { ...gateHere, pressured: true });
    record(run, "pressured", "The buyer asked to skip the limit or said the approver already agreed: the OK goes to the approver's own device.", {});
  }
  if (sent && !sent.line && gateHere?.type === "gate") {
    const order = sent.cards.find((c) => c.type === "order" && c.orderId === gateHere.orderId);
    if (order?.type === "order") store.line(thread, run.turnId, waitingSentence(order, gateHere, body.lang ?? "en", store.cards(thread).map((x) => x.card)) + (pressed ? { en: ` Only their own OK, on their own device, places it.`, fi: " Vain hänen oma hyväksyntänsä omalla laitteellaan tekee tilauksen.", sv: " Bara deras eget godkännande, på deras egen enhet, lägger den." }[body.lang ?? "en"] : ""));
  }
  // An order placed or waiting in this turn with a product whose delivery record is poor: one sentence beneath the
  // order's own reply (server/reliability), a backup offered in case it is not delivered. Most orders say nothing.
  // An order placed by a yes to a card shown earlier updates that card where it was first shown: the orders this turn
  // placed count too.
  const placedNow = [...run.orders.values()].find((o) => o.status === "committed" || o.status === "pending_approval");
  const ordered = store.agentTurn(thread, run.turnId)?.cards.find((c) => c.type === "order" && (c.status === "committed" || c.status === "pending_approval")) ?? (placedNow ? ({ type: "order", orderId: placedNow.orderId, status: placedNow.status } as const) : undefined);
  if (ordered?.type === "order") {
    const { sayBackup } = await import("./backup");
    const b = await sayBackup(run, { orderId: ordered.orderId }, body.lang ?? "en").catch(() => undefined);
    const now = store.agentTurn(thread, run.turnId)?.line ?? "";
    if (b && !now.includes(b.text.slice(0, 30))) store.line(thread, run.turnId, now ? `${now}\n${b.text}` : b.text);
    // The order emails: one clause after the order's own reply; when the backup question was asked, after its answer.
    if (!b) {
      const { mailFactAfterOrder } = await import("@/server/notify/thread");
      const mailFact = await mailFactAfterOrder(run.rt, run.k, { orderId: ordered.orderId, status: ordered.status }, { lang: body.lang ?? "en", threadId: thread.threadId }).catch((err) => {
        console.error("[thread] mail clause", err);
        return undefined;
      });
      const line = store.agentTurn(thread, run.turnId)?.line ?? "";
      if (mailFact && !line.includes(mailFact)) store.line(thread, run.turnId, line ? `${line} ${mailFact}` : mailFact);
      // Whether a sentence about the receipt was said (never the address itself).
      record(run, "mail_clause", mailFact ? "One sentence about the order's email was said after the order." : "Nothing about email was said after the order.", { orderId: ordered.orderId, said: !!mailFact });
    }
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

/**
 * Only whole sentences reach the buyer: a fragment left where a sentence was not backed by the data (or was cut) is
 * dropped; with nothing left, the store's own short sentence for what is on the table (the options, the order).
 */
function wholeSentences(run: TurnRun, t: string): string {
  if (!t) return t;
  const end = (x: string) => /[.!?…]["”»)]?$/.test(x.replace(/\*\*|\{\{|\}\}/g, "").trim());
  if (end(t)) return t;
  const parts = t.split(/(?<=[.!?])\s+/);
  const kept = parts.filter(end);
  if (kept.length) return kept.join(" ");
  const lang = run.lang ?? "en";
  const opts = run.store.agentTurn(run.thread, run.turnId)?.cards.find((c) => c.type === "options" && !c.chosen);
  if (opts?.type === "options") {
    const n = opts.options.filter((o) => o.gate?.outcome !== "reject").length;
    return { en: `${n === 1 ? "One option can" : `${n} options can`} be ordered. Which one?`, fi: `${n === 1 ? "Yksi vaihtoehto" : `${n} vaihtoehtoa`} voidaan tilata. Mikä niistä?`, sv: `${n === 1 ? "Ett alternativ" : `${n} alternativ`} kan beställas. Vilket?` }[lang];
  }
  return `${t.trim()}.`;
}

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
function waitingSentence(order: OrderCard, gate: GateCard, lang: "en" | "fi" | "sv", cards: Card[] = []): string {
  const eur = (c: number) => `**${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €**`;
  const first = order.lines[0];
  const what = first ? `${first.quantity} × ${first.name.replace(/[®™]/g, "").split(/\s+/).slice(0, 4).join(" ")}${order.lines.length > 1 ? (lang === "fi" ? ` ja ${order.lines.length - 1} muuta` : lang === "sv" ? ` och ${order.lines.length - 1} till` : ` and ${order.lines.length - 1} more`) : ""}` : "";
  const over = gate.rules?.find((r) => r.rule === "per_order_limit" && r.outcome !== "pass");
  const limit = over?.details?.limitCents;
  // A signer named by role on the test kitchens ("Kitchen manager") is said in the buyer's language.
  const ROLES: Record<string, Record<"fi" | "sv", string>> = { "kitchen manager": { fi: "keittiöpäällikkö", sv: "köksansvarig" }, "head chef": { fi: "keittiömestari", sv: "kökschef" }, owner: { fi: "omistaja", sv: "ägare" }, "food service manager": { fi: "ruokapalvelupäällikkö", sv: "måltidschef" } };
  const raw = gate.approver?.name ?? "";
  const who = raw ? (lang === "en" ? raw : (ROLES[raw.toLowerCase()]?.[lang] ?? raw)) : lang === "fi" ? "vastuuhenkilö" : lang === "sv" ? "en ansvarig" : "a person";
  const whoEn = /^[A-Z][a-z]+ [a-z]/.test(who) ? `the ${who.toLowerCase()}` : who;
  if (typeof limit === "number") {
    if (lang === "fi") return `${what} hintaan ${eur(order.totalCents)} ylittää ${eur(limit)}, jonka voin käyttää yksin, joten se tarvitsee hyväksynnän: ${who}.`;
    if (lang === "sv") return `${what} för ${eur(order.totalCents)} är över de ${eur(limit)} jag får handla för själv, så det behöver godkännas av ${who}.`;
    return `${what} for ${eur(order.totalCents)} is over the ${eur(limit)} I may spend alone, so it needs ${whoEn}'s OK.`;
  }
  // The mistake check sent it to a person: the comparison that triggered it, from the kitchen's own figures (the
  // gate's shared record names only the kind of check), the same reason the slab shows.
  const w = THREAD_WORDS[lang];
  const f = fmtFor(lang);
  const u = cards.find((c) => c.type === "understood" && c.requestId === order.requestId);
  const note = u?.type === "understood" ? (u.notes ?? []).map((n) => w.note[n.code]?.(n.params as Record<string, string | number>, f)).find(Boolean) : undefined;
  const why = note ?? gateReasons(gate.rules, gate.reasons, w, f, lang)[0] ?? "";
  if (lang === "fi") return `${what} hintaan ${eur(order.totalCents)}${why ? `: ${why.replace(/\.$/, "")}` : ""}, joten se tarvitsee hyväksynnän: ${who}.`;
  if (lang === "sv") return `${what} för ${eur(order.totalCents)}${why ? `: ${why.replace(/\.$/, "")}` : ""}, så det behöver godkännas av ${who}.`;
  return `${what} for ${eur(order.totalCents)}${why ? `: ${why.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}` : ""}, so ${whoEn} is asked to OK it.`;
}

/**
 * A menu shown, planned or changed in this turn: its dishes and ingredients in the reply (menu.ts dishesCard), the
 * changed ones marked against the dishes shown before. Not once it is on an order sheet: then the order is the news.
 */
async function showDishes(run: TurnRun): Promise<void> {
  const d = run.dishesFor;
  if (!d) return;
  const here = run.store.agentTurn(run.thread, run.turnId)?.cards ?? [];
  if (here.some((c) => c.type === "sheet" || c.type === "order" || c.type === "dishes")) return;
  const before = d.changed ? run.store.cards(run.thread).map((x) => x.card).filter((c): c is Extract<Card, { type: "dishes" }> => c.type === "dishes" && c.planId === d.planId).at(-1) : undefined;
  const { dishesCard } = await import("./menu");
  const card = await dishesCard(run, d.planId, before, d.standIns).catch((err) => {
    console.error("[thread] dishes", err);
    return undefined;
  });
  if (card?.dishes.length) run.store.card(run.thread, run.turnId, card);
}

const toldOf = (run: TurnRun): Record<string, string> => ((run.thread as unknown as { told?: Record<string, string> }).told ??= {});
/** The ways forward last offered for a dish not fully buyable (the answer is read against them). */
type WaysForward = { planId: string; categories: string[]; owner: boolean };
const waysOf = (run: TurnRun) => run.thread as unknown as { ways?: WaysForward };
const CLOSING_ASK = /(?:^|\s)[^.!?]*\?\s*$/;

/**
 * Nothing left out, swapped or moved silently (differences.ts): the plan shown or changed in this turn, against what it
 * would buy. Each difference not yet said is said now, with its reason and the way forward; a dish not fully buyable
 * never closes on "Shall I order it?" but on the choice between the ways forward. Recorded, and a difference whose
 * reason the engine lacks is recorded as a defect.
 */
async function tellDifferences(run: TurnRun): Promise<void> {
  const d = run.dishesFor;
  if (!d) return;
  const here = run.store.agentTurn(run.thread, run.turnId);
  if (!here || here.cards.some((c) => c.type === "sheet" || c.type === "order")) return;
  const { planDifferences } = await import("./menu");
  const lang = run.lang ?? "en";
  const pd = await planDifferences(run, d.planId, lang);
  const covers = run.store.cards(run.thread).map((x) => x.card).filter((c): c is MenuCard => c.type === "menu" && c.planId === d.planId).at(-1)?.covers;
  if (!pd.diffs.length || !covers) return;
  const told = toldOf(run);
  const { keyOf, sayDifferences } = await import("./differences");
  const fresh = pd.diffs.filter((x) => !told[keyOf(x)]);
  const left = pd.diffs.some((x) => x.kind === "left_out");
  if (!fresh.length && !left) return;
  const { groupsOf, canDraft } = await import("./refusal");
  const categories = [...new Set(pd.diffs.flatMap((x) => (x.kind === "left_out" && x.reason.code === "rules_groups" ? x.reason.categories : [])))];
  const owner = categories.length > 0 && canDraft(run);
  const ctx = { lang, allowedGroups: groupsOf(pd.allowed, lang), canAskOwner: owner, ...(left ? { dish: { toBuy: pd.toBuy, buyable: [...new Set(pd.buyable.map((b) => b.toLowerCase()))], left: pd.diffs.filter((x) => x.kind === "left_out").length, totalCents: pd.buyableCents } } : {}) };
  const words = { ...sayDifferences(fresh, ctx), ask: sayDifferences(pd.diffs, ctx).ask };
  // A dish not fully buyable is said by plain code alone: how much of it can be bought (the total for those only),
  // what cannot and why, and the ways forward. The dishes are shown with it. Otherwise the agent's words stay, with
  // the differences added and the closing question replaced.
  const line = here.line ?? "";
  const body = left ? "" : line.replace(CLOSING_ASK, "").trim();
  // The dish in three groups says each missing ingredient with its reason on screen: the sentence is the count alone.
  const grouped = here.cards.some((c) => c.type === "dishes" && !!c.groups);
  const said = left && (grouped || !fresh.some((x) => x.kind === "left_out")) ? sayDifferences(pd.diffs.filter((x) => x.kind === "left_out"), ctx).said.split(/(?<=\.)\s/)[0] : words.said;
  run.store.line(run.thread, run.turnId, [body, said, words.ask].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
  for (const x of fresh) told[keyOf(x)] = run.turnId;
  // What was said as left off, by plan: after the order, the reply says it again in the same words (never a new reason).
  const lefts = ((run.thread as unknown as { toldLeftOff?: Record<string, string[]> }).toldLeftOff ??= {});
  lefts[d.planId] = [...new Set(pd.diffs.flatMap((x) => (x.kind === "left_out" ? [x.name.toLowerCase()] : [])))];
  if (left) waysOf(run).ways = { planId: d.planId, categories, owner };
  record(run, "differences_told", `Said before any order: ${fresh.map((x) => `${x.kind} ${x.name}${x.kind === "left_out" ? ` (${x.reason.code})` : ""}`).join("; ") || "the dish is not fully buyable (said before)"}.`, { planId: d.planId, keys: fresh.map(keyOf), complete: !left });
  if (words.unknown.length) record(run, "defect_reason_missing", `The engine had no reason for: ${words.unknown.map((x) => x.name).join(", ")} (said to the buyer as unknown).`, { planId: d.planId, keys: words.unknown.map(keyOf) });
}

/**
 * The same rule for requests (one item or several): each item read in this turn against the option that would be
 * ordered for it (the lead option, or the one put on the order sheet), and an item left out of a several-item order.
 * Said before the yes, never after; nothing here when the turn placed nothing new and asks nothing.
 */
async function tellRequestDifferences(run: TurnRun): Promise<void> {
  const here = run.store.agentTurn(run.thread, run.turnId);
  if (!here) return;
  const lang = run.lang ?? "en";
  const { optionDifferences, keyOf, sayDifferences } = await import("./differences");
  const told = toldOf(run);
  const all = run.store.cards(run.thread).map((x) => x.card);
  const sheet = here.cards.find((c) => c.type === "sheet");
  const fresh: import("./differences").Difference[] = [];
  const extra: string[] = [];
  const line = here.line ?? "";
  const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const understood = here.cards.filter((c): c is Extract<Card, { type: "understood" }> => c.type === "understood" && !!c.requestId);
  for (const u of understood) {
    const opts = all.filter((c): c is Extract<Card, { type: "options" }> => c.type === "options" && c.requestId === u.requestId).at(-1);
    const notice = here.cards.find((c) => c.type === "notice" && c.requestId === u.requestId);
    if (opts && !opts.chosen) {
      const id = opts.adjusted ?? opts.preselected?.optionId;
      const o = opts.options.find((x) => x.optionId === id) ?? opts.options.find((x) => x.gate?.outcome !== "reject");
      if (!o) continue;
      const sub = o.lines.find((l) => l.substituteFor);
      const day = u.deliverOn ?? u.deliverBy;
      const diffs = optionDifferences({ key: u.requestId!, name: u.item, ...(u.amount ? { amount: u.amount } : {}), ...(day ? { day } : {}), exact: !!u.deliverOn }, { delivered: o.delivered, deliveryDate: sheet?.type === "sheet" ? sheet.deliveryDate : o.deliveryDate, ...(sub ? { substituteFor: sub.substituteFor, title: o.title } : {}) });
      fresh.push(...diffs.filter((d) => !told[keyOf(d)]));
    } else if (understood.length > 1 && notice?.type === "notice" && (notice.kind === "refused" || notice.kind === "not_found" || notice.kind === "unavailable")) {
      // An item of a several-item order that will not be on it: its own refusal (the rule, the reason, the next step).
      const k = `left_out:${u.requestId}:notice`;
      if (told[k] || fold(line).includes(fold(u.item).split(/\s+/)[0] ?? "")) continue;
      extra.push(notice.said?.[lang] ?? { en: `${u.item} won't be on the order: ${notice.message}`, fi: `${u.item} ei tule tilaukseen: ${notice.message}`, sv: `${u.item} kommer inte med i beställningen: ${notice.message}` }[lang]);
      told[k] = run.turnId;
    }
  }
  if (!fresh.length && !extra.length) return;
  const words = fresh.length ? sayDifferences(fresh, { lang, allowedGroups: [] }) : { said: "", ask: "", unknown: [] };
  const body = line.replace(CLOSING_ASK, "").trim();
  const closing = CLOSING_ASK.exec(line)?.[0]?.trim() ?? "";
  // The item's own question stays when only a left-out item was added; a difference asks whether to order it like that.
  run.store.line(run.thread, run.turnId, [body, ...extra, words.said, fresh.length && sheet ? words.ask : closing].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
  for (const d of fresh) told[keyOf(d)] = run.turnId;
  record(run, "differences_told", `Said before any order: ${[...fresh.map((d) => `${d.kind} ${d.name}`), ...extra.map(() => "an item left out of the order")].join("; ")}.`, { keys: fresh.map(keyOf) });
}

/**
 * After an order from a plan with ingredients left off: the reply says which, as they were said before the yes; a
 * sentence of the agent's that gives another reason for them ("still waiting for your choice") is not shown.
 */
function sayLeftOffAfterOrder(run: TurnRun): void {
  const planId = run.placedPlan;
  const here = run.store.agentTurn(run.thread, run.turnId);
  if (!planId || !here?.cards.some((c) => c.type === "order")) return;
  const names = (run.thread as unknown as { toldLeftOff?: Record<string, string[]> }).toldLeftOff?.[planId] ?? [];
  if (!names.length) return;
  const lang = run.lang ?? "en";
  const and = lang === "fi" ? "ja" : lang === "sv" ? "och" : "and";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}`;
  const kept = (here.line ?? "").split(/(?<=[.!?])\s+/).filter((x) => !/(aren't|isn't|are not|is not|not) (on|in) (this|the) order|eivät ole tässä tilauksessa|ei ole tilauksessa|eivät ole tilauksessa|finns inte med|inte med i beställningen|left (off|out) (of )?(this|the) order|jäi(vät)? pois|blev kvar utanför/i.test(x));
  const said = { en: `As I said, ${list} ${names.length > 1 ? "aren't" : "isn't"} on it.`, fi: `Kuten sanoin, ${list} ${names.length > 1 ? "eivät ole" : "ei ole"} tilauksessa.`, sv: `Som jag sa finns ${list} inte med.` }[lang];
  kept.splice(Math.min(1, kept.length), 0, said);
  run.store.line(run.thread, run.turnId, kept.join(" "));
}

/**
 * A change to the rules that waits for the approver's passkey is said as exactly that, never as done ("Your rules now
 * include frozen"): the sentence is plain code, whatever the agent wrote.
 */
function sayRulesWaiting(run: TurnRun): void {
  const c = run.rulesWaiting;
  if (c?.type !== "rules" || !c.proposal?.approval) return;
  const lang = run.lang ?? "en";
  const who = c.proposal.approval.approver.name;
  const what = rulesWhat(c.diff, lang);
  run.store.line(run.thread, run.turnId, {
    en: `That widens what I may do${what ? ` (${what})` : ""}, so it needs ${who}'s OK with their passkey: I've sent it to their phone. Nothing changes until they sign.`,
    fi: `Tämä laajentaa sitä, mitä saan tehdä${what ? ` (${what})` : ""}, joten se tarvitsee hyväksynnän pääsyavaimella: ${who}. Lähetin sen hänen puhelimeensa. Mikään ei muutu ennen allekirjoitusta.`,
    sv: `Det vidgar vad jag får göra${what ? ` (${what})` : ""}, så det behöver ${who}s godkännande med nyckel: jag har skickat det till deras telefon. Inget ändras förrän det är signerat.`,
  }[lang]);
}

/** The widening in a few words for a sentence: "frozen", "800 € an order", in the buyer's language. */
function rulesWhat(diff: RulesDiff, lang: "en" | "fi" | "sv"): string {
  return diff
    .filter((d) => d.widens || d.field === "signer")
    .map((d) => {
      if (d.field === "groups") return d.after.split(", ").filter((x) => x && !d.before.split(", ").includes(x)).map((g) => groupNameL(g, lang)).join(", ");
      if (d.field === "perOrderLimitEur") return { en: `${d.after} € an order`, fi: `${d.after} € kerralla`, sv: `${d.after} € per order` }[lang];
      if (d.field === "weeklyBudgetEur") return { en: `${d.after} € a week`, fi: `${d.after} € viikossa`, sv: `${d.after} € i veckan` }[lang];
      if (d.field === "autoRenew") return { en: "renewing a recurring order by myself", fi: "vakiotilauksen uusiminen itse", sv: "att förnya en stående order själv" }[lang];
      const l = changeLines([d], lang)[0] ?? "";
      return l.charAt(0).toLowerCase() + l.slice(1);
    })
    .filter(Boolean)
    .join(", ");
}

/** "Which order?" after "You already ordered …": that order by what it holds, its total and day, and the question again. */
function whichOrder(run: TurnRun, card: Extract<Card, { type: "anomaly" }>, lang: "en" | "fi" | "sv"): string | undefined {
  const k = card.concerns[0];
  const orderId = (k?.evidence as { orderId?: string } | undefined)?.orderId ?? /^duplicate_recent:(\S+)/.exec(k?.key ?? "")?.[1];
  const o = run.store.cards(run.thread).map((x) => x.card).filter((c): c is OrderCard => c.type === "order" && c.orderId === orderId).at(-1);
  if (!o) return undefined;
  const f = fmtFor(lang);
  const what = o.lines.map((l) => `${l.quantity} × ${l.name.replace(/[®™]/g, "").split(/\s+/).slice(0, 4).join(" ")}`).join(", ");
  const day = lang === "en" ? englishDays(f.day(o.deliveryDate)).replace(/\.$/, "") : f.day(o.deliveryDate);
  const total = `**${(o.totalCents / 100).toFixed(2).replace(".", ",")} €**`;
  return {
    en: `The one already placed: ${what} for ${total}, arriving {{${day}}}. Shall I order the same again on top of it?`,
    fi: `Jo tehty tilaus: ${what}, ${total}, toimitus {{${day}}}. Tilaanko saman uudelleen sen lisäksi?`,
    sv: `Den som redan är lagd: ${what} för ${total}, kommer {{${day}}}. Ska jag beställa samma igen utöver den?`,
  }[lang];
}

/** A day named in a sentence: "{{Tuesday 17 Nov}}", "Tue 17 Nov", "ti 17.11.", as an ISO date in the coming months. */
function dayIn(text: string): string | undefined {
  const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const t = text.replace(/\{\{|\}\}|\*\*/g, "");
  const en = /\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(t);
  const fi = /\b(\d{1,2})\.(\d{1,2})\./.exec(t);
  const d = en ? Number(en[1]) : fi ? Number(fi[1]) : 0;
  const m = en ? MON.indexOf(en[2].toLowerCase()) + 1 : fi ? Number(fi[2]) : 0;
  if (!d || !m || m > 12) return undefined;
  const today = helsinkiToday();
  let y = Number(today.slice(0, 4));
  if (m < Number(today.slice(5, 7)) - 6) y++;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "Ask the owner to add them": the kitchen's product groups the dish needs, drafted as a change to its rules. */
async function askOwnerToAdd(run: TurnRun, lang: "en" | "fi" | "sv"): Promise<string> {
  const ways = waysOf(run).ways;
  const { groupIdOf, groupOf } = await import("./refusal");
  const ids = [...new Set((ways?.categories ?? []).map(groupIdOf).filter((x): x is string => !!x))];
  const names = [...new Set((ways?.categories ?? []).map((c) => groupOf(c, lang)).filter((x): x is string => !!x))];
  const { showRules } = await import("./rules");
  const card = ids.length ? await showRules(run, { groupsAdd: ids }).catch(() => undefined) : undefined;
  if (!card?.proposal || card.proposal.state !== "open") return { en: "I couldn't draft that change to your rules here. Shall I order just what I can buy, or plan another dish?", fi: "En pystynyt laatimaan sääntömuutosta täällä. Tilaanko vain sen, minkä voin ostaa, vai suunnittelenko toisen ruuan?", sv: "Jag kunde inte skriva den ändringen här. Ska jag beställa bara det jag kan köpa, eller planera en annan rätt?" }[lang];
  const menu = run.store.cards(run.thread).map((x) => x.card).filter((c): c is MenuCard => c.type === "menu" && c.planId === ways?.planId).at(-1);
  const again = menu ? `${menu.dishes.map((d) => d.name).join(", ")} for ${menu.covers ?? ""}${menu.serviceDate ? ` on ${menu.serviceDate}` : ""}` : "";
  if (again) (run.thread as unknown as { afterRules?: Record<string, string> }).afterRules = { ...((run.thread as unknown as { afterRules?: Record<string, string> }).afterRules ?? {}), [card.proposal.proposalId]: again };
  delete waysOf(run).ways;
  const { list } = { list: (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${lang === "fi" ? "ja" : lang === "sv" ? "och" : "and"} ${xs.at(-1)}`) };
  record(run, "rules_drafted", `A change to the kitchen's rules was drafted at the buyer's word, for a dish it could not buy completely: add ${ids.join(", ")}.`, { proposalId: card.proposal.proposalId });
  if (!card.proposal.canSign) return { en: `I've drafted it: ${list(names)} added to what I may buy. Only the kitchen's own account can confirm it, under Your rules.`, fi: `Laadin muutoksen: ${list(names)} lisätään ostettaviin. Sen voi vahvistaa vain keittiön oma tili kohdassa Sääntösi.`, sv: `Jag har skrivit ändringen: ${list(names)} läggs till. Bara kökets eget konto kan bekräfta den, under Dina regler.` }[lang];
  const signer = card.current.approvers[0]?.name ?? "";
  return { en: `I've drafted it: ${list(names)} added to what I may buy. That needs ${signer || "the signer"}'s OK with their passkey: shall I send it to them? Then I'll plan the dish again.`, fi: `Laadin muutoksen: ${list(names)} lisätään ostettaviin. Se tarvitsee hyväksynnän pääsyavaimella (${signer || "allekirjoittaja"}): lähetänkö sen? Sitten suunnittelen ruuan uudelleen.`, sv: `Jag har skrivit ändringen: ${list(names)} läggs till. Den behöver godkännas med nyckel (${signer || "den som signerar"}): ska jag skicka den? Sedan planerar jag rätten igen.` }[lang];
}

/** A turn that failed or timed out, in the ledger (and so the telemetry): a stable code and the duration, no words. */
function turnFailed(run: TurnRun, code: TurnFailure): void {
  const ms = Date.now() - run.t0;
  try {
    record(run, "turn_failed", `The agent's turn failed (${code}) after ${ms} ms.`, { code, ms });
  } catch {
    // the record is best effort; the buyer already has the notice
  }
}

/** The end of an agent turn: what to remember, its status (waiting for the buyer, for a person, or done) and the record. */
async function finishTurn(run: TurnRun): Promise<void> {
  const { store, thread } = run;
  await showDishes(run);
  sayRulesWaiting(run);
  await tellDifferences(run).catch((err) => console.error("[thread] differences", err));
  await tellRequestDifferences(run).catch((err) => console.error("[thread] request differences", err));
  sayLeftOffAfterOrder(run);
  const a = store.agentTurn(thread, run.turnId)!;
  const waitingApprover = a.cards.some((c) => c.type === "gate" && c.outcome === "waiting");
  const waitingBuyer = !waitingApprover && a.cards.some((c) => (c.type === "anomaly" && !c.answered) || c.type === "question" || (c.type === "options" && !c.chosen) || (c.type === "menu" && !c.sheetId && (c.stage === "choose" || c.stage === "ready")) || (c.type === "price" && !a.cards.some((x) => x.type === "gate" && x.requestId === c.requestId)));
  store.mark(thread, run.turnId, "done", Date.now() - run.t0);
  store.status(thread, run.turnId, waitingApprover ? "waiting_approver" : waitingBuyer ? "waiting_buyer" : "done", { ms: Date.now() - run.t0, marks: a.marks });
  // How it ended, as codes the operations scorecard reads (answered, asked, ordered, sent_for_signoff, refused + rule).
  const ended = turnOutcome(a.status, a.cards);
  record(run, "turn_done", `Agent turn finished (${a.status}, ${ended.outcome}${ended.rule ? ` by ${ended.rule}` : ""}) in ${Date.now() - run.t0} ms: ${a.cards.map((c) => c.type).join(", ") || "no cards"}.`, { status: a.status, ...ended, ms: Date.now() - run.t0, marks: a.marks, cards: a.cards.map((c) => c.type), requests: [...run.requests], orders: [...run.orders.keys()] });
  // A turn that ends with nothing for the buyer (no sentence, no card) failed them, whatever its status says.
  if (!a.line?.trim() && !a.cards.length) turnFailed(run, "empty_reply");
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

/**
 * A change to the kitchen's rules that widens what the agent may do, decided by the named approver: on their phone
 * (/approve/rch_..., server/thread/rules-signoff.ts) or in this browser. The prompt is bound to the exact change, the
 * mandate it changes, the decision and a fresh nonce; the answer is checked by the same verifier as an order's
 * sign-off. Only a verified passkey signature applies the change. Either way the conversation says it where the
 * change waited, and then carries on with what was waiting on it (the buy the rules refused).
 */
export async function rulesSignOffOptions(kitchen: Kitchen | string, proposalId: string, rp: Parameters<Runtime["passkeys"]["approvalOptions"]>[0], decision: "approve" | "decline" = "approve") {
  const r = await resolve(kitchen, "typed");
  const e = await engine(r.rt);
  const thread = e.store.get(r.k.info.slug, r.k.info.orgId);
  const { rulesApproval } = await import("./rules");
  const a = rulesApproval({ thread, k: r.k }, proposalId);
  if (!a) throw new DockError(409, "rules_change_not_waiting", "That change is not waiting for a sign-off.");
  return r.rt.passkeys.approvalOptions(rp, { approvalId: a.approval.approvalId, orgId: a.orgId, role: a.approval.approver.role, orderDigest: a.digest, decision });
}

/** A run on the turn that holds the waiting change: what is decided is said there, beneath what was said before. */
async function rulesHolderRun(kitchen: Kitchen | string, proposalId: string) {
  const r = await resolve(kitchen, "typed");
  const e = await engine(r.rt);
  const thread = e.store.get(r.k.info.slug, r.k.info.orgId);
  const id = cardId("rules", proposalId);
  const p = ((thread as unknown as { rulesProposals?: Record<string, import("./rules").Proposal> }).rulesProposals ?? {})[proposalId];
  // Said beneath the reply that said it waits (the card itself is updated in place wherever it was first shown).
  const holder = (p?.approval?.turnId ? e.store.agentTurn(thread, p.approval.turnId) : undefined) ?? [...thread.turns].reverse().find((x): x is AgentTurn => x.role === "agent" && x.cards.some((c) => c.cardId === id));
  if (!holder) throw new DockError(409, "rules_change_not_waiting", "That change is not waiting for a sign-off.");
  const asked = e.store.turn(thread, holder.replyTo);
  const buyer: BuyerTurn = asked?.role === "buyer" ? asked : { turnId: holder.replyTo, role: "buyer", at: holder.at, door: "typed", via: "tap" };
  const lang = p?.approval?.lang ?? "en";
  const run: TurnRun = { rt: r.rt, store: e.store, thread, turnId: holder.turnId, buyer, k: r.k, session: r.session, person: r.person, door: "typed", lang, t0: Date.now(), facts: [], requests: new Set(), orders: new Map(), readings: new Map() };
  return { r, e, thread, holder, run, lang };
}

const clockHki = (iso: string) => new Date(iso).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Helsinki" });

/** "…then I'll order the burger buns": the buy that waited on this change, as the conversation said it. */
function waitingOn(thread: StoredThread, proposalId: string): { words?: string; what?: string } {
  const t = thread as unknown as { afterRules?: Record<string, string>; afterRulesWhat?: Record<string, string>; afterRulesUsed?: string[] };
  if (t.afterRulesUsed?.includes(proposalId)) return {};
  return { words: t.afterRules?.[proposalId], what: t.afterRulesWhat?.[proposalId] };
}

function sayBeneath(run: TurnRun, text: string): void {
  const before = run.store.agentTurn(run.thread, run.turnId)?.line ?? "";
  run.store.line(run.thread, run.turnId, before && !before.includes(text) ? `${before}\n${text}` : text);
}

export async function rulesSignOff(kitchen: Kitchen | string, proposalId: string, proof: unknown) {
  const r = await resolve(kitchen, "typed");
  const e = await engine(r.rt);
  const thread = e.store.get(r.k.info.slug, r.k.info.orgId);
  const { rulesApproval, signRules } = await import("./rules");
  const a = rulesApproval({ thread, k: r.k }, proposalId);
  if (!a) throw new DockError(409, "rules_change_not_waiting", "That change is not waiting for a sign-off.");
  const { ApprovalProofSchema } = await import("@/core/approval");
  const p = ApprovalProofSchema.safeParse(proof);
  if (!p.success || p.data.kind !== "webauthn") throw new DockError(400, "passkey_required", "A change that widens what the agent may do is signed with the approver's passkey.");
  const v = await r.rt.passkeys.verifier.verify({ approval: a.approval, orgId: a.orgId, orderDigest: a.digest, decision: "approve", now: new Date() }, p.data);
  if (!v.ok) throw new DockError(403, v.reason, v.message);
  const h = await rulesHolderRun(kitchen, proposalId);
  const card = await withTurn({ threadId: h.thread.threadId, turnId: h.run.turnId, door: "typed", kitchen: h.r.k.info.slug, orgId: h.r.k.info.orgId, agentId: h.r.session.agentId }, async () => {
    const card = await signRules(h.run, proposalId, { signOff: v.signOff });
    const name = v.signOff.method === "passkey" ? v.signOff.approverName : a.approval.approver.name;
    const { changeClauses } = await import("@/app/k/[kitchen]/rules-change");
    const what = changeClauses(card.diff, h.lang);
    const next = waitingOn(h.thread, proposalId);
    const lang = h.lang;
    const carry = next.words ? { en: next.what ? ` Now the ${next.what}.` : " Now, what was waiting on it.", fi: next.what ? ` Jatkan nyt: ${next.what}.` : " Jatkan nyt siitä, mikä odotti.", sv: next.what ? ` Nu fortsätter jag med ${next.what}.` : " Nu fortsätter jag med det som väntade." }[lang] : "";
    const at = clockHki(v.signOff.at);
    sayBeneath(h.run, { en: `${name} signed the change with their passkey at ${at}${what ? `: ${what}` : ""}.${carry}`, fi: `${name} allekirjoitti muutoksen pääsyavaimella klo ${at}${what ? `: ${what}` : ""}.${carry}`, sv: `${name} signerade ändringen med nyckel kl. ${at}${what ? `: ${what}` : ""}.${carry}` }[lang]);
    h.e.store.save(h.thread);
    return card;
  });
  // The buy that waited on this change, asked again now that the rules allow it: a reply of its own, beneath.
  const next = waitingOn(thread, proposalId);
  if (next.words) void carryOn(kitchen, h, proposalId, next.words).catch((err) => console.error("[thread] after rules", err));
  return { proposal: card.proposal?.state };
}

/** The approver declined: nothing changes; the conversation says so, and that what waited on it is not bought. */
export async function rulesDecline(kitchen: Kitchen | string, proposalId: string, decided: { by: string; at: string; method: string; note?: string }) {
  const h = await rulesHolderRun(kitchen, proposalId);
  const { declineRules } = await import("./rules");
  const card = await withTurn({ threadId: h.thread.threadId, turnId: h.run.turnId, door: "typed", kitchen: h.r.k.info.slug, orgId: h.r.k.info.orgId, agentId: h.r.session.agentId }, async () => {
    const card = await declineRules(h.run, proposalId, decided);
    const next = waitingOn(h.thread, proposalId);
    const t = h.thread as unknown as { afterRulesUsed?: string[] };
    if (next.words) t.afterRulesUsed = [...(t.afterRulesUsed ?? []), proposalId];
    const lang = h.lang;
    const left = next.words ? { en: next.what ? `, so I haven't ordered the ${next.what}` : ", so nothing that waited on it is ordered", fi: next.what ? `, joten en tilannut: ${next.what}` : ", joten mitään sitä odottanutta ei tilattu", sv: next.what ? `, så jag har inte beställt ${next.what}` : ", så inget som väntade på den är beställt" }[lang] : "";
    sayBeneath(h.run, { en: `${decided.by} declined the change at ${clockHki(decided.at)}: your rules stay as they were${left}.`, fi: `${decided.by} hylkäsi muutoksen klo ${clockHki(decided.at)}: säännöt pysyvät ennallaan${left}.`, sv: `${decided.by} avböjde ändringen kl. ${clockHki(decided.at)}: era regler är som förut${left}.` }[lang]);
    h.e.store.save(h.thread);
    return card;
  });
  return { proposal: card.proposal?.state };
}

/** A change nobody signed in time, found lapsed: said once where it waited; nothing changes. */
export async function rulesLapse(kitchen: Kitchen | string, proposalId: string) {
  const h = await rulesHolderRun(kitchen, proposalId);
  const { expireRules } = await import("./rules");
  await withTurn({ threadId: h.thread.threadId, turnId: h.run.turnId, door: "typed", kitchen: h.r.k.info.slug, orgId: h.r.k.info.orgId, agentId: h.r.session.agentId }, async () => {
    const card = await expireRules(h.run, proposalId);
    if (!card) return;
    sayBeneath(h.run, { en: "Nobody signed the change in time, so your rules stay as they were.", fi: "Kukaan ei allekirjoittanut muutosta ajoissa, joten säännöt pysyvät ennallaan.", sv: "Ingen signerade ändringen i tid, så era regler är som förut." }[h.lang]);
    h.e.store.save(h.thread);
  });
}

/**
 * The buy that waited on a change to the rules, asked again once it is signed: a new agent turn answering the same
 * request (no new buyer words appear), through the same engine, queued behind any turn still working.
 */
async function carryOn(kitchen: Kitchen | string, h: Awaited<ReturnType<typeof rulesHolderRun>>, proposalId: string, words: string): Promise<void> {
  const t = h.thread as unknown as { afterRulesUsed?: string[] };
  if (t.afterRulesUsed?.includes(proposalId)) return;
  t.afterRulesUsed = [...(t.afterRulesUsed ?? []), proposalId];
  const { e, thread, lang } = h;
  // The kitchen read again: its agent's session must present the mandate just signed, not the one before it.
  const fresh = await resolveKitchen(h.r.k.info.slug);
  if (!fresh) return;
  const r = await resolve(typeof kitchen === "string" ? fresh : ({ ...fresh, ...(kitchen.console ? { console: kitchen.console } : {}) } as Kitchen), "typed");
  const at = new Date().toISOString();
  const turn: AgentTurn = { turnId: newId("trn"), role: "agent", at, replyTo: h.holder.replyTo, status: "working", steps: [], cards: [] };
  e.store.addTurn(thread, turn);
  e.store.status(thread, turn.turnId, "working");
  const buyer: BuyerTurn = { ...h.run.buyer, text: words };
  const run: TurnRun = { rt: r.rt, store: e.store, thread, turnId: turn.turnId, buyer, k: r.k, session: r.session, person: r.person, door: "typed", lang, t0: Date.now(), facts: [], requests: new Set(), orders: new Map(), readings: new Map() };
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, fallbacks: 0, toolCalls: 0 };
  const first = step(run, "read", "Reading your request");
  run.opening = first;
  record(run, "after_rules", `The rules now allow it: the earlier request "${words.slice(0, 80)}" is asked again after the change was signed.`, { proposalId });
  const queued = e.queues.get(thread.threadId) ?? Promise.resolve();
  const next = Promise.race([queued, new Promise<void>((res) => setTimeout(res, 20_000))]).then(() =>
    withTurn({ threadId: thread.threadId, turnId: turn.turnId, door: "typed", kitchen: r.k.info.slug, orgId: r.k.info.orgId, agentId: r.session.agentId, usage }, () => work(run, { door: "typed", via: "typed", text: words, lang }, first)).catch((err) => {
      console.error("[thread] after rules", err);
      e.store.status(thread, turn.turnId, "failed", { ms: Date.now() - run.t0 });
      turnFailed(run, failureOf(err));
    }),
  );
  e.queues.set(thread.threadId, next);
  await next;
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
    if (err instanceof DockError) throw err;
    // The model's own error is kept as the cause, so the turn's failure is recorded with what really failed.
    throw Object.assign(new DockError(503, "agent_unavailable", "The agent did not answer. Try again in a moment."), { cause: err });
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
    // What is left of a sentence the data did not back is not shown as a fragment.
    const kept = wholeSentences(run, plainLine(run, g.text.replace(/\s+/g, " ").trim()));
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
    // The watch's record of an order it switched or renewed follows the decision (its "sent for sign-off" ends).
    void import("@/server/watch/service").then((w) => w.orderSettled(rt, orderId, order.status)).catch(() => undefined);
    e.store.card(t, holder.turnId, gateCard(order));
    const prevOrder = e.store.cards(t).find((x) => x.card.type === "order" && x.card.orderId === orderId);
    e.store.card(t, holder.turnId, orderCard(order, prevOrder?.card.type === "order" ? prevOrder.card.passedOver : []));
    if (order.status === "pending_approval") return;
    const wait = t.waits[orderId];
    if (!wait) {
      // No agent loop waits for this order (a watch switch, an offer, a sheet placed by a tap): the turn still says what
      // happened, beneath what it said before, in plain words from the order itself.
      const a = e.store.agentTurn(t, holder.turnId);
      const said = afterSignOff(order, (a?.line ?? "").match(/[äöå]/i) ? "fi" : "en");
      if (a && said && !(a.line ?? "").includes(said)) e.store.line(t, holder.turnId, a.line ? `${a.line}\n${said}` : said);
      if (a?.status === "waiting_approver") e.store.status(t, holder.turnId, "done", { ms: a.ms });
      return;
    }
    delete t.waits[orderId];
    await resumeAfterSignOff(rt, kitchen, t, wait, order);
  }
}

/** The words of a buy the kitchen's rules refused, when the last turn signed the change that allows it and the buyer says yes. */
function afterRulesWords(run: TurnRun, words: string): string | undefined {
  if (words.trim().split(/\s+/).length > 8 || !/^(yes|yeah|sure|ok|okay|please|go ahead|order it|kyllä|joo|tilaa|ja|gärna)\b/i.test(words.trim())) return undefined;
  const store = run.thread as unknown as { afterRules?: Record<string, string>; afterRulesUsed?: string[] };
  // The rules card is updated in place when signed: the newest signed proposal with a refused buy waiting on it.
  const signed = run.store.cards(run.thread).map((x) => x.card).filter((c) => c.type === "rules" && c.proposal?.state === "signed").at(-1);
  const pid = signed?.type === "rules" ? signed.proposal?.proposalId : undefined;
  if (!pid || !store.afterRules?.[pid] || store.afterRulesUsed?.includes(pid)) return undefined;
  store.afterRulesUsed = [...(store.afterRulesUsed ?? []), pid];
  return store.afterRules[pid];
}

/** Words that change a menu already planned, rather than start a new one. */
const MENU_CHANGE = /\b(we have|we've got|we got|we're out of|we are out of|out of|no more|meillä on|meiltä puuttuu|loppu|vi har|slut på|make it|make them|no\s+\w+|without|lactose|gluten|nut-?free|vegan|vegetarian|instead|swap|replace|drop|remove|leave out|add|more|less|fewer|portions?|people|servings|ilman|tee siitä|laktoositon|gluteeniton|lisää|poista|vaihda|jätä pois|annosta|hengelle|utan|byt|ta bort|lägg till)\b/i;

/** "Make it lactose-free" while a menu is the subject: changed by the menu adapter, its sentence said; else undefined. */
async function changeMenuInWords(run: TurnRun, words: string, lang: "en" | "fi" | "sv"): Promise<string | undefined> {
  // "Yes" to "shall I find one without it?" (an ingredient the kitchen's allergen rule stops): the same as "make it lactose-free".
  if (words.trim().split(/\s+/).length <= 5) {
    const { yesOrNo } = await import("@/server/channels/speech");
    const last = [...run.thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
    const { openMenu } = await import("./menu");
    const stop = openMenu(run)?.dishes.flatMap((d) => d.lines).flatMap((l) => l.conflicts).find((x) => x.blocking && x.code === "forbidden_allergens");
    if (stop && yesOrNo(words) === "yes" && last?.role === "agent" && /(without (it|that|them|lactose|gluten|milk)|ilman (sitä|niitä|laktoosia|gluteenia)|utan (den|det|laktos|gluten))[^.]*\?/i.test(last.line ?? "")) {
      const allergen = /allergen\(s\): ([a-z_ ,]+)/i.exec(stop.text)?.[1]?.split(/,\s*/)[0] ?? "lactose";
      words = `make it ${{ lactose: "lactose-free", gluten: "gluten-free", milk: "dairy-free" }[allergen] ?? `${allergen}-free`}`;
    }
  }
  if (words.trim().split(/\s+/).length > 14 || !MENU_CHANGE.test(words)) return undefined;
  const { subjectOf } = await import("./subject");
  const subj = subjectOf(run);
  if (subj?.kind !== "menu" || !subj.planId) return undefined;
  // A plain number of portions is the covers widget's (menu:covers); words beyond it are a change to the plan.
  if (/^\s*\d+\s*(portions?|people|annosta|hengelle|portioner)?\s*$/i.test(words)) return undefined;
  const { changeMenu, menuChecks } = await import("@/server/agent/menu/thread");
  const c = await changeMenu(run.k.info.slug, subj.planId, words, byLine(run), lang);
  if (!c.edits.length) return undefined;
  const { refreshMenu } = await import("./menu");
  let card = await refreshMenu(run, subj.planId).catch(() => undefined);
  // A line the kitchen's allergen rule still stops (the chocolate with milk in it): one search for the same ingredient
  // without it, and if none is found, said by name with the one way on (leave it out), never "made it lactose-free".
  const blockedOf = (m: MenuCard | undefined) => (m?.dishes ?? []).flatMap((d) => d.lines).find((l) => l.conflicts.some((x) => x.blocking && x.code === "forbidden_allergens"));
  let blocked = blockedOf(card);
  if (blocked) {
    const allergen = /allergen\(s\): ([a-z_ ,]+)/i.exec(blocked.conflicts.find((x) => x.code === "forbidden_allergens")?.text ?? "")?.[1]?.split(/,\s*/)[0] ?? "lactose";
    const free = { lactose: "lactose-free", gluten: "gluten-free", milk: "dairy-free" }[allergen] ?? `${allergen}-free`;
    const again = await changeMenu(run.k.info.slug, subj.planId, `use ${free} ${blocked.ingredient.toLowerCase()} instead of the ${blocked.ingredient.toLowerCase()}`, byLine(run), lang).catch(() => undefined);
    if (again?.edits.length) {
      card = await refreshMenu(run, subj.planId).catch(() => card);
      blocked = blockedOf(card);
    }
  }
  run.dishesFor = { planId: subj.planId, changed: true };
  if (blocked) {
    const allergen = /allergen\(s\): ([a-z_ ,]+)/i.exec(blocked.conflicts.find((x) => x.code === "forbidden_allergens")?.text ?? "")?.[1]?.split(/,\s*/)[0] ?? "lactose";
    const { attrL } = await import("@/app/_i18n/format");
    const a = attrL(allergen, lang).toLowerCase();
    // The ingredient in the buyer's language: the planner's own word for it (the dishes shown below).
    const { dishesCard } = await import("./menu");
    const named = (await dishesCard(run, subj.planId).catch(() => undefined))?.dishes.flatMap((d) => d.items).find((i) => i.lineId === blocked!.lineId)?.name[lang];
    const ing = (named ?? blocked.ingredient).toLowerCase();
    (run.thread as unknown as { leaveOut?: { planId: string; lineId: string } }).leaveOut = { planId: subj.planId, lineId: blocked.lineId };
    const head = c.say.replace(/^(Made it|Muutin sen:|Gjorde den)[^.]*\.\s*/, "");
    return {
      en: `${head} The ${ing} still contains ${a}, and I found none without it, so it can't be ordered as it is. Shall I leave the ${ing} out?`,
      fi: `${head} Raaka-aineessa ${ing} on yhä ${a}, enkä löytänyt sitä ilman, joten tätä ei voi tilata näin. Jätänkö sen pois?`,
      sv: `${head} ${ing.charAt(0).toUpperCase() + ing.slice(1)} innehåller fortfarande ${a}, och jag hittade ingen utan, så det går inte att beställa så här. Ska jag utelämna den?`,
    }[lang].trim();
  }
  record(run, "menu_changed", `The menu on the table was changed in words ("${words.slice(0, 80)}"): ${c.changed.slice(0, 4).join("; ")}.`, { planId: subj.planId, changed: c.changed });
  if (c.checks.refusedDish) {
    const m = await menuChecks(run.k.info.slug, subj.planId, lang).catch(() => undefined);
    if (m?.say) return `${c.say} ${m.say}${m.ask ? ` ${m.ask}` : ""}`.trim();
  }
  // The change said, then the question that moves it on: a yes orders the changed menu.
  if (card?.stage === "ready" && card.totalCents > 0 && !card.blockers.length) {
    const day = card.serviceDate ? (lang === "en" ? englishDays(fmtFor(lang).day(card.serviceDate)).replace(/\.$/, "") : fmtFor(lang).day(card.serviceDate)) : "";
    return `${c.say} ${{ en: `Shall I order it${day ? ` for ${day}` : ""}?`, fi: `Tilaanko sen${day ? ` (${day})` : ""}?`, sv: `Ska jag beställa den${day ? ` till ${day}` : ""}?` }[lang]}`;
  }
  return c.say;
}

/** A yes to "Shall I draft that change for you to confirm?": the proposal, said in one sentence, or undefined. */
async function draftRulesChange(run: TurnRun, words: string, lang: "en" | "fi" | "sv"): Promise<string | undefined> {
  if (words.trim().split(/\s+/).length > 8) return undefined;
  const { yesOrNo } = await import("@/server/channels/speech");
  if (yesOrNo(words) !== "yes" && !/\b(ask|draft|do it|go ahead|kysy|laadi|fråga)\b/i.test(words)) return undefined;
  const last = [...run.thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
  const notice = last?.role === "agent" ? last.cards.find((c) => c.type === "notice" && c.addGroup) : undefined;
  if (notice?.type !== "notice" || !notice.addGroup) return undefined;
  const { showRules } = await import("./rules");
  const card = await showRules(run, { groupsAdd: [notice.addGroup.id] });
  if (!card.proposal || card.proposal.state !== "open") return undefined;
  (run.thread as unknown as { afterRules?: Record<string, string> }).afterRules = { ...((run.thread as unknown as { afterRules?: Record<string, string> }).afterRules ?? {}), [card.proposal.proposalId]: notice.addGroup.words };
  (run.thread as unknown as { afterRulesWhat?: Record<string, string> }).afterRulesWhat = { ...((run.thread as unknown as { afterRulesWhat?: Record<string, string> }).afterRulesWhat ?? {}), [card.proposal.proposalId]: notice.addGroup.what };
  const { groupOf } = await import("./refusal");
  const { DEPARTMENT_NAME } = await import("@/app/k/[kitchen]/catalogue.text");
  const name = (lang === "en" ? undefined : DEPARTMENT_NAME[lang][notice.addGroup.id]) ?? card.vocabulary.groups.find((g) => g.id === notice.addGroup!.id)?.name ?? groupOf(notice.addGroup.id, lang) ?? "";
  const g = name.charAt(0).toLowerCase() + name.slice(1);
  record(run, "rules_drafted", `A change to the kitchen's rules was drafted at the buyer's yes: add ${notice.addGroup.id} (${g}), to buy "${notice.addGroup.what}".`, { proposalId: card.proposal.proposalId });
  if (!card.proposal.canSign) return { en: `I've drafted it: ${g} added to what I may buy. Only the kitchen's own account can confirm it, under Your rules.`, fi: `Laadin muutoksen: ${g} lisätään ostettaviin. Sen voi vahvistaa vain keittiön oma tili kohdassa Sääntösi.`, sv: `Jag har skrivit ändringen: ${g} läggs till. Bara kökets eget konto kan bekräfta den, under Dina regler.` }[lang];
  // Adding a product group widens what the agent may buy: it goes to the named approver's passkey, never a typed yes.
  const signer = card.current.approvers[0]?.name ?? "";
  return { en: `I've drafted it: ${g} added to what I may buy. That needs ${signer || "the signer"}'s OK with their passkey: shall I send it to them? Then I'll order the ${notice.addGroup.what}.`, fi: `Laadin muutoksen: ${g} lisätään ostettaviin. Se tarvitsee hyväksynnän pääsyavaimella (${signer || "allekirjoittaja"}): lähetänkö sen? Sitten tilaan: ${notice.addGroup.what}.`, sv: `Jag har skrivit ändringen: ${g} läggs till. Den behöver godkännas med nyckel (${signer || "den som signerar"}): ska jag skicka den? Sedan beställer jag ${notice.addGroup.what}.` }[lang];
}

/** The buyer's short answer to the offer the last agent turn (or the opening) said: done by plain code, or undefined. */
async function answerOpenOffer(run: TurnRun, words: string, lang: "en" | "fi" | "sv"): Promise<string | undefined> {
  if (words.trim().split(/\s+/).length > 8) return undefined;
  const { openOffer, offerAnswerIn, answerOfferIn } = await import("./offer");
  const offer = openOffer(run);
  if (!offer) return undefined;
  const holder = run.thread.turns.find((x) => x.role === "agent" && x.cards.some((c) => c.cardId === offer.cardId));
  const later = holder ? run.thread.turns.slice(run.thread.turns.indexOf(holder) + 1).filter((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "") : [];
  if (!holder || later.length) return undefined;
  const LATER = /\b(maybe later|later|not today|another time|myöhemmin|ehkä myöhemmin|ei tänään|senare|kanske senare)\b/i;
  const answer = offerAnswerIn(words) ?? (LATER.test(words) ? "no" : undefined);
  if (!answer) return undefined;
  const r = await answerOfferIn(run, offer.offerId, answer, words, lang);
  return r.reply || undefined;
}

/** What happened when the person decided, in one sentence: OK'd and arriving, declined, or the price ran out. */
function afterSignOff(order: PublicOrder, lang: "en" | "fi"): string {
  const who = order.approval?.approver.name ?? (lang === "fi" ? "hyväksyjä" : "the approver");
  const date = order.lines[0]?.deliveryDate ?? "";
  const day = englishDays(`${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${date}T12:00:00Z`).getUTCDay()]} ${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`);
  if (order.status === "committed") return lang === "fi" ? `${who} hyväksyi tilauksen; se tulee ${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.` : `${who} OK'd it: it arrives ${day}`;
  if (order.status === "declined") return lang === "fi" ? `${who} hylkäsi tilauksen, joten mitään ei tilattu.` : `${who} declined it, so nothing is ordered.`;
  if (order.status === "expired") return lang === "fi" ? "Hinta umpeutui ennen hyväksyntää, joten mitään ei tilattu." : "The price ran out before the OK, so nothing is ordered.";
  if (order.status === "withdrawn") return lang === "fi" ? "Tilaus peruttiin, joten mitään ei tilattu." : "It was taken back, so nothing is ordered.";
  return "";
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
