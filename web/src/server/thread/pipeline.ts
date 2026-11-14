import { priceProof } from "./home";
import { DockError } from "@/core/errors";
import { RELAYED, type HumanVia, type IntakeView } from "@/core/intake";
import { primaryLine, type KitchenProfile } from "@/core/kitchen";
import { NeedSchema, type NeedInput, type StructuredNeed } from "@/core/need";
import type { AgentSession, PublicOrder } from "@/core/orders";
import { interpretRequest, type EarlierRequest } from "@/server/agent/interpret";
import type { ConsolePerson } from "@/server/console-context";
import type { Kitchen } from "@/server/kitchen-portal";
import { callTool } from "@/server/mcp/server";
import { qualifiersOf, wordsNotCarried } from "@/core/qualifiers";
import { TOOLS } from "@/server/mcp/tools";
import type { Runtime } from "@/server/runtime";
import { anomalyCard, cardId, gateCard, noOptionsCard, optionsCard, orderCard, passedOver, priceCard, questionCard, understoodCard } from "./cards";
import { threadTag } from "./context";
import type { StoredThread, ThreadStore } from "./store";
import type { BuyerTurn, NoticeCard, OptionView, ThreadAction, ThreadDoor } from "./types";

/**
 * The engine for the common case, in plain code: read the buyer's words once (interpret.ts, the one reader every
 * door uses), run the staged intake through the published tools (server/mcp/tools.ts, called as the kitchen's own
 * agent), show each step as cards the moment it exists, and place a routine order alone. Nothing here asks a model
 * to compute, choose or decide: the reader reads, the intake asks and ranks, the gate decides.
 */

export type TurnRun = {
  rt: Runtime;
  store: ThreadStore;
  thread: StoredThread;
  /** The agent turn being worked on. */
  turnId: string;
  buyer: BuyerTurn;
  k: Kitchen;
  session: AgentSession;
  person?: ConsolePerson;
  door: ThreadDoor;
  t0: number;
  /** Everything the agent turn's cards were built from: the facts the model's line is checked against. */
  facts: unknown[];
  /** Requests and orders this turn touched, for the trace and for what to remember. */
  requests: Set<string>;
  orders: Map<string, PublicOrder>;
  /** Readings started before the agent asked for them (speculative), by the words read. */
  readings: Map<string, Promise<Reading>>;
  /** The turn's first visible step ("Reading your request"), finished by the first reading instead of a second step. */
  opening?: ReturnType<typeof step>;
  /** Several items in one message: none is placed alone; the ones ready become one order sheet (combineItems). */
  multi?: boolean;
};

export type Reading = Awaited<ReturnType<typeof interpretRequest>> & { earlier: EarlierRequest[] };

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no published tool ${name}`);
  return t;
};

/** One published tool, as the kitchen's own agent, with the result shaped as MCP shapes it (or a DockError). */
async function published<T = Record<string, unknown>>(run: TurnRun, name: string, args: unknown): Promise<T> {
  const out = await callTool(run.rt, run.session, tool(name), args);
  return out as T;
}

// ---------- steps ----------

let stepN = 0;
export function step(run: TurnRun, kind: string, label: string) {
  const stepId = `s${++stepN}`;
  const startedAt = new Date().toISOString();
  const t = Date.now();
  run.store.step(run.thread, run.turnId, { stepId, kind, label, status: "running", startedAt });
  if (run.store.agentTurn(run.thread, run.turnId)?.steps.length === 1) run.store.mark(run.thread, run.turnId, "first_step", Date.now() - run.t0);
  const end = (status: "done" | "failed" | "skipped", detail?: string) => run.store.step(run.thread, run.turnId, { stepId, kind, label, status, startedAt, ms: Date.now() - t, ...(detail ? { detail } : {}) });
  return { done: (detail?: string) => end("done", detail), fail: (detail?: string) => end("failed", detail), skip: (detail?: string) => end("skipped", detail) };
}

const mark = (run: TurnRun, name: "understood" | "options" | "placed" | "waiting") => run.store.mark(run.thread, run.turnId, name, Date.now() - run.t0);

/** A conversation entry in the ledger (type agent), tagged with the thread, the turn and the door. */
export function record(run: Pick<TurnRun, "rt" | "thread" | "turnId" | "door" | "session">, event: string, summary: string, data: Record<string, unknown> = {}, requestId?: string): void {
  run.rt.dock.ledger.append({ type: "agent", actor: `agent:${run.session.agentId}`, summary, ...(requestId ? { requestId } : {}), data: { event, ...threadTag({ threadId: run.thread.threadId, turnId: run.turnId, door: run.door }), ...data } });
}

// ---------- reading ----------

/**
 * Words that pass on someone else's answer ("the chef said yes", "keittiömestari sanoi että käy", "kocken säger ja"):
 * whoever types them, the answer is not their own, so it is recorded as relayed even from a signed-in session.
 */
const PASSED_ON = /\b(said|says|told me|asked me to|confirmed|approved|okayed|according to|sanoi|sanoo|kertoi|vahvisti|hyväksyi|mukaan|sa|säger|sade|bekräftade|godkände|enligt)\b/i;
const SOMEONE_ELSE = /\b(the |our |my )?(chef|head chef|cook|boss|manager|owner|kitchen manager|keittiömestari|kokki|esimies|pomo|omistaja|keittiöpäällikkö|kocken|kock|chefen|ägaren|köksmästaren)\b/i;
export function passedOn(words: string | undefined): boolean {
  return !!words && SOMEONE_ELSE.test(words) && PASSED_ON.test(words);
}

/** Whose words these are, as the intake records them: the kitchen's signed-in person, or relayed. */
export function humanVia(run: TurnRun, words?: string): HumanVia {
  if (!run.person || passedOn(words)) return words ? { ...RELAYED, words: words.slice(0, 300) } : RELAYED;
  if (run.door === "voice" && words) return { channel: "voice", person: run.person.name, words: words.slice(0, 300) };
  return { channel: "portal_session", person: run.person.name };
}

export function byLine(run: TurnRun): string {
  const who = run.person?.name ?? run.k.info.by;
  return `${who} (${run.door === "voice" ? "by voice" : run.buyer.via === "tap" ? "tapped in the store" : "typed in the store"})`.slice(0, 120);
}

/** The reader, once per distinct words in a turn (the agent may ask for a reading already started). */
export function read(run: TurnRun, words: string, earlier: EarlierRequest[]): Promise<Reading> {
  const key = `${words}\u0000${earlier.map((e) => e.id).join(",")}`;
  let p = run.readings.get(key);
  if (!p) {
    p = interpretRequest({ text: words, ...(earlier.length ? { earlier } : {}) }, { catalog: run.rt.catalog, mandate: run.session.mandate, door: run.door === "voice" ? "voice" : "typed", secondGraceMs: Number(process.env.DOCK_THREAD_SECOND_GRACE_MS ?? 1500) }).then((r) => ({ ...r, earlier }));
    p.catch(() => undefined);
    run.readings.set(key, p);
  }
  return p;
}

// ---------- several items in one message ----------

const DAY_PHRASE = /\b(for|by|on|until|before|till|to|ennen|mennessä|torstaiksi|maanantaiksi|på|senast|innan)\b[^,;\n]*$/i;

/** Item parts of a message, split where a new amount starts after "and", a comma or a new line; the day said at the end goes to each. */
export function splitItems(text: string): string[] {
  const raw = text.split(/\s*(?:,|;|\n|\band\b|\bja\b|\bsekä\b|\boch\b|\bsamt\b|\bplus\b)\s*(?=\d)/i).map((x) => x.trim()).filter(Boolean);
  if (raw.length < 2 || raw.some((x) => !/\d/.test(x))) return [];
  const day = DAY_PHRASE.exec(raw.at(-1)!)?.[0];
  return raw.map((x) => (day && !DAY_PHRASE.test(x) ? `${x} ${day}` : x)).slice(0, 5);
}

// ---------- words the assortment does not carry ----------

/**
 * The words of the item that say what it is ("camel" in "camel milk", "oat" in "oat drink"), checked by plain code
 * against the products themselves with the catalogue's own search: which words no product of the family carries at
 * all (`absent`), and which words each option's main product does not carry (`notCarried`). The intake finds the
 * family; this keeps a stand-in from being shown as the thing asked for (core/qualifiers.ts, which the gate uses too).
 */
export async function qualifierCheck(run: TurnRun, family: string, item: string, options: OptionView[]): Promise<{ absent: string[]; notCarried: Map<string, string[]> }> {
  const q = await qualifiersOf(run.rt.catalog, family, item);
  const main = (o: OptionView) => [...o.lines].sort((a, b) => b.quantity * (b.packSize ?? 1) - a.quantity * (a.packSize ?? 1))[0]?.productId;
  const notCarried = new Map<string, string[]>();
  for (const o of options) {
    const id = main(o);
    const lacks = id ? wordsNotCarried(q, id) : [];
    if (lacks.length) notCarried.set(o.optionId, lacks);
  }
  return { absent: q.absent, notCarried };
}

// ---------- the intake ----------

export type ItemOutcome = {
  words: string;
  requestId?: string;
  state?: IntakeView["state"];
  /** What the agent did alone, if anything. */
  placed?: { orderId: string; status: string; totalCents: number; approver?: string };
  notice?: NoticeCard;
  options?: { ref: string; optionId: string; title: string; totalCents: number; deliveryDate: string; match: string }[];
  concerns?: { message: string; choices: string[] }[];
  questions?: { text: string; choices: string[] }[];
  /** An earlier order this one replaced ("make it 200" after the 100 was placed): taken back. */
  replaced?: { orderId: string; status: string };
  /** The words went on an order sheet to confirm (the usual, from the kitchen's recurring orders). */
  sheet?: { sheetId: string; deliveryDate: string; lines: { name: string; packs: number }[]; totalCents: number };
};

function noticeFrom(err: unknown, ref: string, words: string): NoticeCard {
  if (err instanceof DockError) {
    const id = cardId("notice", ref);
    if (err.code === "need_incomplete") {
      const missing = ((err.details?.missing as string[]) ?? []).map((m) => (m === "item" ? "what to buy" : "how much, with the unit"));
      return { type: "notice", cardId: id, kind: "incomplete", message: `I understood part of "${words.slice(0, 80)}" but need ${missing.join(" and ")}.`, missing };
    }
    if (err.code === "not_a_purchase_request") return { type: "notice", cardId: id, kind: "not_purchase", message: err.message };
    if (err.code === "family_unknown") return { type: "notice", cardId: id, kind: "not_found", message: `Nothing in the assortment matches "${words.slice(0, 80)}".` };
    if (["model_unavailable", "interpret_timeout", "interpret_failed", "llm_disabled", "demo_limit_reached"].includes(err.code)) return { type: "notice", cardId: id, kind: "unavailable", message: err.message, retry: true };
    if (err.code === "agent_suspended" || err.rule === "suspended") return { type: "notice", cardId: id, kind: "suspended", message: err.message };
    return { type: "notice", cardId: id, kind: "refused", message: err.message, ...(err.rule ? { rule: err.rule } : {}) };
  }
  return { type: "notice", cardId: cardId("notice", ref), kind: "error", message: "Something went wrong on our side. Try again.", retry: true };
}

/** "The usual", in the kitchen's languages. */
const USUAL = /\b(the usual|usual order|as usual|tavalli\w*|tavanomai\w*|det vanliga|som vanligt|vanliga)\b/i;

/** The recurring orders due next (one day: the soonest any is due), at their usual amounts, as one order sheet. */
async function usualSheet(run: TurnRun, words: string): Promise<{ requestId: string; sheetId: string; deliveryDate: string; lines: { name: string; packs: number }[]; totalCents: number } | undefined> {
  const { standing } = await import("@/server/kitchen-portal");
  const { createSheet } = await import("./sheet");
  const profile = await run.rt.kitchens.getProfile(run.session.mandate.issuer.orgId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(new Date());
  const due = standing(profile, today).filter((s) => s.nextDue && !profile?.pausedStanding?.includes(s.family));
  const next = due.map((s) => s.nextDue!).sort()[0];
  if (!next) return undefined;
  const lines: { productId: string; packs: number }[] = [];
  for (const s of due.filter((x) => x.nextDue === next)) {
    const [p] = await run.rt.catalog.searchProducts({ ids: [s.product.productId], limit: 1 });
    if (p && run.session.mandate.allowedCategories.includes(p.category)) lines.push({ productId: p.id, packs: Math.max(1, Math.ceil(s.usual.amount / p.packSize - 1e-9)) });
  }
  if (!lines.length) return undefined;
  record(run, "usual", `"${words.slice(0, 80)}" named no product: the kitchen's recurring orders due ${next} go on the order sheet at their usual amounts.`, { day: next, lines });
  const card = await createSheet(run, { lines, deliveryDate: next, text: words, asked: lines.map((l) => l.productId) });
  return { requestId: card.requestId!, sheetId: card.sheetId, deliveryDate: card.deliveryDate, lines: card.lines.map((l) => ({ name: l.name, packs: l.packs })), totalCents: card.totalCents };
}

/**
 * Read one request's words and run it through the intake: understood, then whatever the intake says (a check, a
 * question, options), then, for a routine request, the order placed alone. Several items in one message each come
 * through here, in parallel.
 */
export async function orderFromWords(run: TurnRun, words: string, earlier: EarlierRequest[], opts: { deliverBy?: string; item?: number; quietIfNotPurchase?: boolean } = {}): Promise<ItemOutcome[]> {
  const ref = `${run.turnId}:${opts.item ?? 0}`;
  const reading = !opts.item && run.opening ? run.opening : step(run, "read", opts.item ? `Reading "${words.slice(0, 40)}"` : "Reading your request");
  if (!opts.item) run.opening = undefined;
  let r: Reading;
  try {
    r = await read(run, words, earlier);
    reading.done(r.model);
  } catch (err) {
    const notice = noticeFrom(err, ref, words);
    // Words the reader says are not a purchase, asked through the agent: the agent answers them itself (a question
    // about the cards on screen), so no "not a purchase" card is shown.
    if (opts.quietIfNotPurchase && notice.kind === "not_purchase") {
      reading.skip("not a purchase request");
      record(run, "read_not_purchase", `The reader found no purchase in "${words.slice(0, 200)}"; the agent answers it instead.`, {});
      return [{ words, notice }];
    }
    // Several items the reader could not hold together ("30 litres of milk and 6 litres of cream for Thursday"):
    // split by plain code at the item boundaries, the day said once given to each, and read each part.
    const parts = notice.kind === "incomplete" && !opts.item ? splitItems(words) : [];
    if (parts.length >= 2) {
      reading.done("several items: read one by one");
      record(run, "split_items", `The message names ${parts.length} items; each is read on its own: ${parts.map((x) => `"${x}"`).join(", ")}.`, { parts });
      run.multi = true;
      return combineItems(run, words, (await Promise.all(parts.map((x, i) => orderFromWords(run, x, [], { ...opts, item: i + 1 })))).flat());
    }
    // "The usual" with no product named: the kitchen's own records say what that is (its recurring orders due
    // next, at their usual amounts), on the order sheet to confirm. Plain code, nothing guessed.
    if (notice.kind === "incomplete" && notice.missing?.includes("what to buy") && !opts.item && USUAL.test(words)) {
      const usual = await usualSheet(run, words).catch(() => undefined);
      if (usual) {
        reading.done("the usual, from your recurring orders");
        return [{ words, requestId: usual.requestId, sheet: usual }];
      }
    }
    reading.fail(err instanceof DockError ? err.code : undefined);
    run.store.card(run.thread, run.turnId, notice);
    run.facts.push(notice);
    record(run, "read_failed", `The request could not be read: ${notice.message}`, { code: err instanceof DockError ? err.code : "error" });
    return [{ words, notice }];
  }
  const need = { ...(r.need as NeedInput) };
  // A second item of the same message without its own day takes the day the message gave (plain code, said once).
  if (!need.deliverBy && opts.deliverBy) need.deliverBy = opts.deliverBy;
  // A change to the request on the table ("make it 200 litres") keeps what it did not restate: its day.
  const base = r.basedOn && earlier.find((e) => e.id === r.basedOn!.requestId);
  const baseDay = base && typeof base.need?.deliverBy === "string" ? (base.need.deliverBy as string) : undefined;
  if (!need.deliverBy && !(need as { deliverOn?: string }).deliverOn && baseDay && baseDay >= new Date().toISOString().slice(0, 10) && r.basedOn) {
    need.deliverBy = baseDay;
    if (!r.basedOn.fields.includes("deliverBy")) r.basedOn = { ...r.basedOn, fields: [...r.basedOn.fields, "deliverBy"] };
  }
  const basedOn = r.basedOn ? { ...r.basedOn, label: earlier.find((e) => e.id === r.basedOn!.requestId)?.text ?? undefined } : undefined;
  const alsoAsked = (r.alsoAsked ?? []).map((a) => a.text);
  const parsed = NeedSchema.parse(need) as StructuredNeed;
  // The other items the same message named: read and run in parallel with this one.
  if (!opts.item && (r.alsoAsked ?? []).length) run.multi = true;
  const others = opts.item ? [] : (r.alsoAsked ?? []).slice(0, 4).map((a, i) => orderFromWords(run, a.text, [], { deliverBy: parsed.deliverBy, item: i + 1 }));
  const first = await openNeed(run, need, words, { ref, ...(basedOn ? { basedOn: { requestId: basedOn.requestId, fields: basedOn.fields, ...(basedOn.label ? { label: basedOn.label } : {}) } } : {}), alsoAsked: opts.item ? [] : alsoAsked });
  const all = [...first, ...(await Promise.all(others)).flat()];
  return opts.item ? all : combineItems(run, words, all);
}

/**
 * Several items in one message are one order: each item's lead option (the one its card would order) goes on one
 * order sheet, priced and previewed by the gate once, confirmed once. Items still waiting on a question or a check
 * keep their own card and join by "Add" when answered. The options cards say they were handed to the sheet.
 */
async function combineItems(run: TurnRun, words: string, items: ItemOutcome[]): Promise<ItemOutcome[]> {
  if (!run.multi) return items;
  const ready: { s: IntakeView; optionId: string }[] = [];
  for (const it of items) {
    if (it.state !== "options_ready" || !it.requestId || it.placed) continue;
    const s = await run.rt.dock.intake.get(run.session, it.requestId).catch(() => undefined);
    if (!s || s.state !== "options_ready") continue;
    const card = run.store.cards(run.thread).map((x) => x.card).find((c) => c.type === "options" && c.requestId === it.requestId);
    const views = card?.type === "options" ? card.options : [];
    const lead = (card?.type === "options" && card.preselected && views.find((o) => o.optionId === card.preselected!.optionId && o.gate?.outcome !== "reject")) || views.find((o) => o.gate?.outcome !== "reject");
    if (lead) ready.push({ s, optionId: lead.optionId });
  }
  if (ready.length < 2) return items;
  const { createSheet } = await import("./sheet");
  const lines = ready.flatMap(({ s, optionId }) => {
    const o = s.options.find((x) => x.optionId === optionId)!;
    return o.quoteLines.map((l, n) => ({ productId: l.productId, packs: l.quantity, ...(l.substituteFor ? { substituteFor: l.substituteFor } : n === 0 && o.alternative?.for && o.alternative.for !== l.productId ? { substituteFor: o.alternative.for } : {}) }));
  });
  const day = ready.map(({ s, optionId }) => s.options.find((x) => x.optionId === optionId)!.deliveryDate).sort().at(-1);
  record(run, "combined", `The message named ${ready.length} items: their options go on one order sheet, one order through the gate.`, { items: ready.map((r) => ({ requestId: r.s.requestId, optionId: r.optionId })) });
  const sheet = await createSheet(run, { lines, ...(day ? { deliveryDate: day } : {}), text: words });
  for (const { s, optionId } of ready)
    for (const x of run.thread.turns)
      if (x.role === "agent") for (const c of x.cards) if (c.type === "options" && c.requestId === s.requestId) run.store.card(run.thread, x.turnId, { ...c, adjusted: optionId });
  return [...items, { words, requestId: sheet.requestId, sheet: { sheetId: sheet.sheetId, deliveryDate: sheet.deliveryDate, lines: sheet.lines.map((l) => ({ name: l.name, packs: l.packs })), totalCents: sheet.totalCents } }];
}

/**
 * A need, however it was made (read from words, or rebuilt by plain code from an earlier order), through the
 * intake: the understood card, then whatever the intake says, then a routine order placed alone.
 */
export async function openNeed(run: TurnRun, need: NeedInput, words: string, opts: { ref: string; basedOn?: { requestId: string; fields: string[]; label?: string }; alsoAsked?: string[]; memoryLine?: string }): Promise<ItemOutcome[]> {
  // A kitchen's day ("for Thursday", "torstaiksi") is the day it wants the goods, not a latest date: delivered that day
  // when it can be (the intake moves the wholesaler's earliest offer to it). Earlier only when that day cannot be had.
  const n = need as { deliverBy?: string; deliverOn?: string };
  // Words that set a latest day ("by Monday", "mennessä", "senast") keep it a latest day.
  const latest = /\b(by|before|at the latest|no later than|mennessä|viimeistään|ennen|senast|innan|före)\b/i.test(words);
  if (n.deliverBy && !n.deliverOn && !latest && n.deliverBy > new Date().toISOString().slice(0, 10)) need = { ...need, deliverOn: n.deliverBy } as NeedInput;
  const parsed = NeedSchema.parse(need) as StructuredNeed;
  const understood = understoodCard({ ref: opts.ref, words, need: parsed, ...(opts.basedOn ? { basedOn: opts.basedOn } : {}), alsoAsked: opts.alsoAsked ?? [], ...(opts.memoryLine ? { memoryUsed: [opts.memoryLine] } : {}) });
  run.store.card(run.thread, run.turnId, understood);
  run.facts.push(understood, { words });
  mark(run, "understood");
  const intake = step(run, "intake", "Checking against your history and the assortment");
  try {
    const res = await published<{ step: IntakeView }>(run, "submit_need", { need, by: byLine(run) });
    intake.done(res.step.state);
    run.requests.add(res.step.requestId);
    let step0 = res.step;
    if (opts.basedOn && (await noteReplacement(run, res.step.requestId, opts.basedOn.requestId))) {
      // "Make it 200" is a repeat of the order it replaces by design: the repeat check's only question is answered by
      // the buyer's own words (recorded as theirs, or as relayed), and that order goes back once the new one is placed.
      const dup = step0.state === "needs_confirmation" && step0.concerns.length > 0 && step0.concerns.every((c) => c.code === "duplicate_recent" && c.confirmable);
      if (dup) {
        step0 = await run.rt.dock.intake.respondToConcerns(run.session, step0.requestId, { by: byLine(run), responses: step0.concerns.map((c) => ({ key: c.key, choice: "confirm" })) }, humanVia(run, words));
        record(run, "replaces_repeat", `The repeat check on ${res.step.requestId} is the order it replaces: answered by the buyer's change "${words.slice(0, 80)}".`, {}, res.step.requestId);
      }
    }
    run.store.card(run.thread, run.turnId, { ...understood, requestId: res.step.requestId, memoryUsed: [...(opts.memoryLine ? [opts.memoryLine] : []), ...res.step.memoryUsed.map((m) => m.text)], memory: res.step.memoryUsed, ...(res.step.noticed?.length ? { notes: res.step.noticed.map((n) => ({ code: n.code, params: n.params })) } : {}) });
    if (res.step.memoryUsed.length) record(run, "memory_read", `Memory answered for this request: ${res.step.memoryUsed.map((m) => m.text).join("; ")}`, { lines: res.step.memoryUsed }, res.step.requestId);
    return [await afterStep(run, step0, words)];
  } catch (err) {
    intake.fail(err instanceof DockError ? err.code : undefined);
    const notice = noticeFrom(err, opts.ref, words);
    run.store.card(run.thread, run.turnId, notice);
    run.facts.push(notice);
    return [{ words, notice }];
  }
}

/** Show a step as cards; place a routine order alone. */
export async function afterStep(run: TurnRun, s: IntakeView, words: string): Promise<ItemOutcome> {
  run.facts.push(s);
  const out: ItemOutcome = { words, requestId: s.requestId, state: s.state };
  const anomaly = anomalyCard(s);
  if (anomaly && s.state === "needs_confirmation") {
    run.store.card(run.thread, run.turnId, anomaly);
    record(run, "anomaly", `Flagged: ${s.concerns.map((c) => c.message).join(" ")}`, { codes: s.concerns.map((c) => c.code) }, s.requestId);
    out.concerns = s.concerns.map((c) => ({ message: c.message, choices: [...(c.confirmable ? ["confirm"] : []), ...c.corrections.map((x) => x.label)] }));
    return out;
  }
  const q = questionCard(s);
  if (q && s.state === "needs_input") {
    run.store.card(run.thread, run.turnId, q);
    out.questions = s.questions.map((x) => ({ text: x.text, choices: x.options.map((o) => o.label) }));
    return out;
  }
  if (s.state === "no_options" || s.state === "cancelled") {
    const n = noOptionsCard(s);
    if (s.state === "cancelled") Object.assign(n, { kind: "refused", message: s.notes.join(" ") || "The request was cancelled." });
    run.store.card(run.thread, run.turnId, n);
    out.notice = n;
    return out;
  }
  if (s.state === "options_ready") {
    const card = optionsCard(s)!;
    // Several items in one message are read and joined here, so the intake's "you also asked for" note does not apply.
    if (run.multi) card.notes = card.notes.filter((n) => !/^You also asked for /.test(n));
    // In the store, the tap is the kitchen's own signed-in person: their choice of a stand-in is their confirmation
    // (core/policy.ts substitutionConfirmedBy), so a card held only by the substitution rule is placed alone.
    if (run.person) {
      for (const o of card.options) {
        const g = s.options.find((x) => x.optionId === o.optionId)?.gate;
        if (g && g.outcome === "needs_human_approval" && g.escalated.length && g.escalated.every((r) => r === "substitution_rule")) o.gate = { outcome: "auto_approve", reasons: g.reasons };
      }
    }
    // A word of the request no product in the assortment carries ("camel" in "camel milk"): the options are the
    // closest products, never shown as the thing asked for, and the agent does not choose one alone.
    const q = await qualifierCheck(run, s.family, s.need.item.text, card.options);
    for (const o of card.options) {
      const lacks = q.notCarried.get(o.optionId);
      if (!lacks?.length) continue;
      o.match = "compromise";
      o.givesUp = [`not ${lacks.join(" ")}${q.absent.length ? ": nothing in the assortment is" : ""}`, ...o.givesUp];
    }
    const missing = [...new Set([...q.notCarried.values()].flat())];
    if (q.absent.length) {
      const notice: NoticeCard = { type: "notice", cardId: cardId("notice", `${s.requestId}:missing`), requestId: s.requestId, kind: "not_found", message: `Nothing in the assortment is "${s.need.item.text}". The options are the closest products the wholesaler has.` };
      run.store.card(run.thread, run.turnId, notice);
      run.facts.push(notice);
      out.notice = notice;
    }
    const asked = (s.need as { deliverOn?: string }).deliverOn ?? s.need.deliverBy;
    if (asked) card.askedDay = asked;
    // The kind asked for exists but none of it can be offered: say why, first, from the products left out that carry it.
    if (missing.length && !q.absent.length && card.options.every((o) => q.notCarried.has(o.optionId))) {
      const ids = [...new Set(s.excluded.map((e) => e.productId))].slice(0, 100);
      const named = ids.length ? await run.rt.catalog.searchProducts({ ids, limit: 100 }).catch(() => []) : [];
      const words = missing.map((m) => m.toLowerCase());
      const kindIds = new Set(named.filter((p) => words.every((w) => `${p.name} ${Object.values(p.names ?? {}).join(" ")}`.toLowerCase().includes(w))).map((p) => p.id));
      const why = s.excluded.filter((e) => kindIds.has(e.productId));
      const count = (test: (e: (typeof why)[number]) => boolean) => why.filter(test).length;
      const rules = count((e) => /^not |category|contains|allergen|the kitchen does not want/.test(e.reason));
      const day = count((e) => e.code === "cutoff_passed" || e.code === "too_late");
      const stock = count((e) => e.code === "out_of_stock" || e.code === "no_substitute" || e.code === "no_offer");
      const top = Math.max(rules, day, stock);
      const kind: NonNullable<typeof card.insteadOf>["why"] = !why.length || top === 0 ? "other" : top === rules ? "rules" : top === day ? "day" : "stock";
      const attr = kind === "rules" ? /^not ([a-z_]+)/.exec(why.find((e) => /^not [a-z_]+$/.test(e.reason))?.reason ?? "")?.[1] : undefined;
      card.insteadOf = { asked: s.need.item.text, why: kind, ...(attr ? { attr } : {}), ...(kind === "day" && s.need.deliverBy ? { day: s.need.deliverBy } : {}) };
    }
    if (missing.length) record(run, "not_in_assortment", `The options do not carry "${missing.join(" ")}" (from "${s.need.item.text}")${q.absent.length ? ", and nothing in the assortment does" : ""}: they are shown as stand-ins, not as a match.`, { words: missing, absent: q.absent }, s.requestId);
    run.store.card(run.thread, run.turnId, card);
    mark(run, "options");
    out.options = card.options.map((o, i) => ({ ref: `o${i + 1}`, optionId: o.optionId, title: o.title, totalCents: o.totalCents, deliveryDate: o.deliveryDate, match: o.match }));
    const routine = missing.length || run.multi ? undefined : await routineChoice(run, s, card.options);
    if (!routine) return out;
    record(run, "autonomy", `Routine request inside the mandate: the agent chooses "${routine.option.title}" alone (${routine.why}).`, { optionId: routine.option.optionId, why: routine.why }, s.requestId);
    const chose = step(run, "quote", "Fixing the price with the wholesaler");
    let quoted: IntakeView;
    try {
      quoted = (await published<{ step: IntakeView }>(run, "choose_option", { requestId: s.requestId, optionId: routine.option.optionId, by: `${run.k.info.agentName} (routine order: ${routine.why})`.slice(0, 120) })).step;
      chose.done();
    } catch (err) {
      chose.fail(err instanceof DockError ? err.code : undefined);
      return out;
    }
    run.store.card(run.thread, run.turnId, { ...card, chosen: routine.option.optionId });
    return placeQuoted(run, quoted, words, passedOver(s, routine.option.optionId), true);
  }
  if (s.state === "quoted") return placeQuoted(run, s, words, [], false);
  return out;
}

/**
 * The agent may choose alone only when nothing is in doubt: no check was raised on this request, the best match is a
 * full match nobody has to sign off, and it is the product this kitchen usually buys for this family (or the one the
 * intake pre-selected from a goal the buyer gave). Anything else waits for the buyer's tap.
 */
async function routineChoice(run: TurnRun, s: IntakeView, options: OptionView[]): Promise<{ option: OptionView; why: string } | undefined> {
  if (s.acknowledgements.length || s.concerns.length || (s.alsoAsked ?? []).length) return undefined;
  const clean = options.filter((o) => o.match === "full" && o.signOff.length === 0 && (!o.gate || o.gate.outcome === "auto_approve"));
  if (!clean.length) return undefined;
  const profile = (await run.rt.kitchens.getProfile(run.session.mandate.issuer.orgId)) as KitchenProfile | undefined;
  const recent = (profile?.history ?? []).filter((h) => h.family === s.family).slice(-4);
  const usual = new Set(recent.map((h) => primaryLine(h).productId));
  if (!usual.size) return undefined; // a kitchen with no history here: the buyer picks
  const main = (o: OptionView) => [...o.lines].sort((a, b) => b.quantity * (b.packSize ?? 1) - a.quantity * (a.packSize ?? 1))[0]?.productId;
  const pre = s.preselected && clean.find((o) => o.optionId === s.preselected!.optionId);
  if (pre && usual.has(main(pre) ?? "")) return { option: pre, why: `${s.preselected!.reason}; the product you usually order` };
  const usualOnes = clean.filter((o) => usual.has(main(o) ?? ""));
  if (usualOnes.length === 1 && options[0].optionId === usualOnes[0].optionId) return { option: usualOnes[0], why: "the product you usually order, ranked first, fully in stock terms you asked for" };
  return undefined;
}

/** Send a quoted request to the gate (the published place_order) and show what it decided. */
export async function placeQuoted(run: TurnRun, s: IntakeView, words: string, passed: { title: string; totalCents: number; why: string }[], alone: boolean): Promise<ItemOutcome> {
  const out: ItemOutcome = { words, requestId: s.requestId, state: s.state };
  const price = priceCard(s);
  if (price) {
    // The proof opens in place: the signed quote and the signed claims it rests on, checked in the browser.
    if (s.quote) price.proof = await priceProof(run, s.quote.quoteToken, s.quote.quote.evidence).catch(() => undefined);
    run.store.card(run.thread, run.turnId, price);
    run.facts.push(price);
  }
  // Only an order inside the mandate goes alone. A quote the gate would send to a person waits for the buyer's word.
  if (alone && s.quote?.policyPreview.outcome !== "auto_approve") return out;
  const gate = step(run, "gate", "Checking the order against your rules");
  let order: PublicOrder;
  try {
    order = (await published<{ order: PublicOrder }>(run, "place_order", { requestId: s.requestId })).order;
    gate.done(order.status);
  } catch (err) {
    const refused = err instanceof DockError ? (err.details?.order as PublicOrder | undefined) : undefined;
    gate.fail(err instanceof DockError ? (err.rule ?? err.code) : undefined);
    if (refused) {
      run.store.card(run.thread, run.turnId, gateCard(refused));
      run.facts.push(refused);
      out.placed = { orderId: refused.orderId, status: refused.status, totalCents: refused.totalCents };
      run.orders.set(refused.orderId, refused);
      return out;
    }
    const notice = noticeFrom(err, `${s.requestId}:place`, words);
    run.store.card(run.thread, run.turnId, notice);
    out.notice = notice;
    return out;
  }
  run.orders.set(order.orderId, order);
  run.facts.push(order);
  run.store.card(run.thread, run.turnId, gateCard(order));
  run.store.card(run.thread, run.turnId, orderCard(order, passed));
  mark(run, order.status === "pending_approval" ? "waiting" : "placed");
  out.placed = { orderId: order.orderId, status: order.status, totalCents: order.totalCents, ...(order.approval ? { approver: order.approval.approver.name } : {}) };
  const replaced = await replaceEarlier(run, s.requestId, order);
  if (replaced) out.replaced = replaced;
  return out;
}

// ---------- a change to an order already placed ----------

const replacesOf = (run: TurnRun): Record<string, string> => ((run.thread as unknown as { replaces?: Record<string, string> }).replaces ??= {});

/**
 * "Make it 200" after the 100 was placed: the new request replaces that order. Noted when the change is read, so the
 * new order, once placed (alone or by the buyer's tap), takes the old one back: one order stands, never both.
 * Only an order that can still go back: waiting for an OK, or placed and before its cut-off with a signed-in person.
 */
async function noteReplacement(run: TurnRun, requestId: string, earlierRequestId: string): Promise<boolean> {
  const { takeBackUntil } = await import("@/core/orders");
  const old = (await run.rt.dock.listOrders()).find((o) => o.requestId === earlierRequestId && o.orgId === run.session.mandate.issuer.orgId && (o.status === "pending_approval" || (o.status === "committed" && !!run.person && !!takeBackUntil(o))));
  if (!old) return false;
  replacesOf(run)[requestId] = old.orderId;
  record(run, "replaces", `The new request ${requestId} changes order ${old.orderId}: placing it takes that order back.`, { orderId: old.orderId }, requestId);
  return true;
}

async function replaceEarlier(run: TurnRun, requestId: string, placed: PublicOrder): Promise<{ orderId: string; status: string } | undefined> {
  const oldId = replacesOf(run)[requestId];
  if (!oldId || (placed.status !== "committed" && placed.status !== "pending_approval")) return undefined;
  delete replacesOf(run)[requestId];
  try {
    const o = await run.rt.dock.withdrawOrder(run.session, oldId, { reason: `replaced by order ${placed.orderId}`, ...(run.person ? { by: run.person.name } : {}) }, run.person ? { takeBack: { by: run.person.name } } : {});
    run.store.card(run.thread, run.turnId, gateCard(o));
    run.store.card(run.thread, run.turnId, orderCard(o));
    record(run, "replaced", `Order ${oldId} was taken back: order ${placed.orderId} replaces it.`, { orderId: oldId, by: placed.orderId }, requestId);
    return { orderId: oldId, status: o.status };
  } catch {
    return undefined; // its cut-off passed meanwhile: both stand, and the old one's card says so
  }
}

// ---------- the buyer's own decisions ----------

/** The card an action answers must still be open: a tap on an old card never acts on a newer request. */
export async function checkOpen(run: TurnRun, a: ThreadAction): Promise<IntakeView | undefined> {
  if (a.type !== "concern" && a.type !== "answer" && a.type !== "choose" && a.type !== "place") return undefined;
  const s = await run.rt.dock.intake.get(run.session, a.requestId);
  const want = a.type === "concern" ? ["needs_confirmation"] : a.type === "answer" ? ["needs_input", "options_ready"] : a.type === "choose" ? ["options_ready"] : ["quoted"];
  if (!want.includes(s.state)) throw new DockError(409, "turn_card_stale", `That card has moved on: the request is now ${s.state.replace(/_/g, " ")}.`, "intake_sequence", { state: s.state });
  return s;
}

/**
 * A decision the buyer made, by a tap or in words the agent mapped onto a card. The intake records whose answer it
 * is (the kitchen's signed-in person, or relayed); the words heard go to the ledger with it.
 */
export async function runAction(run: TurnRun, a: ThreadAction, words?: string): Promise<ItemOutcome[]> {
  const via = humanVia(run, words);
  const by = byLine(run);
  if (words) record(run, "heard", `Heard from the buyer before ${a.type}: "${words.slice(0, 300)}"`, { heard: words.slice(0, 1000), action: a }, "requestId" in a ? a.requestId : undefined);
  const dock = run.rt.dock;
  switch (a.type) {
    case "concern": {
      const st = step(run, "intake", a.choice === "confirm" ? "Recording your confirmation" : "Applying your correction");
      const s = await dock.intake.respondToConcerns(run.session, a.requestId, { by, responses: [{ key: a.key, choice: a.choice }] }, via);
      st.done(s.state);
      const prev = run.store.cards(run.thread).find((x) => x.card.cardId === cardId("anomaly", a.requestId));
      if (prev?.card.type === "anomaly") run.store.card(run.thread, prev.turnId, { ...prev.card, answered: { choice: a.choice, by, verified: via.channel !== "relayed" } });
      run.requests.add(a.requestId);
      return [await afterStep(run, s, words ?? "")];
    }
    case "answer": {
      const st = step(run, "intake", "Recording your answer");
      const s = await dock.intake.answer(run.session, a.requestId, { by, answers: [{ questionId: a.questionId, optionId: a.optionId, ...(a.remember ? { remember: true } : {}) }] }, via);
      st.done(s.state);
      const prev = run.store.cards(run.thread).find((x) => x.card.cardId === cardId("question", a.requestId));
      if (prev?.card.type === "question") run.store.card(run.thread, prev.turnId, { ...prev.card, answered: { ...prev.card.answered, [a.questionId]: a.optionId } });
      run.requests.add(a.requestId);
      return [await afterStep(run, s, words ?? "")];
    }
    case "choose": {
      const st = step(run, "quote", "Fixing the price with the wholesaler");
      const before = await dock.intake.get(run.session, a.requestId);
      const s = await dock.intake.choose(run.session, a.requestId, { by, optionId: a.optionId }, via);
      st.done();
      const prev = run.store.cards(run.thread).find((x) => x.card.cardId === cardId("options", a.requestId));
      if (prev?.card.type === "options") run.store.card(run.thread, prev.turnId, { ...prev.card, chosen: a.optionId });
      run.requests.add(a.requestId);
      return [await placeQuoted(run, s, words ?? "", passedOver(before, a.optionId).length ? [] : [], false)];
    }
    case "place": {
      const s = await dock.intake.get(run.session, a.requestId);
      run.requests.add(a.requestId);
      return [await placeQuoted(run, s, words ?? "", [], false)];
    }
    case "withdraw": {
      const st = step(run, "gate", "Taking the order back");
      // Waiting for sign-off: withdrawn. Already placed: taken back before the cut-off, by the kitchen's signed-in person only.
      const o = await dock.withdrawOrder(run.session, a.orderId, run.person ? { by: run.person.name } : {}, run.person ? { takeBack: { by: run.person.name } } : {});
      st.done(o.status);
      run.store.card(run.thread, run.turnId, gateCard(o));
      run.store.card(run.thread, run.turnId, orderCard(o));
      return [{ words: words ?? "", requestId: o.requestId, placed: { orderId: o.orderId, status: o.status, totalCents: o.totalCents } }];
    }
    case "repeat": {
      // The earlier order rebuilt by plain code: no model, and the same intake and gate as anything else.
      const { overview } = await import("@/server/kitchen-portal");
      const { repeatNeed } = await import("@/app/k/[kitchen]/memory");
      const ov = await overview(run.k);
      const r = ov.requests.find((x) => (x.requestId ?? x.key) === a.ref || x.key === a.ref || x.order?.orderId === a.ref);
      const rep = r && repeatNeed(r);
      if (!r || !rep) throw new DockError(404, "nothing_to_repeat", "That earlier order cannot be repeated from here: nothing to rebuild it from.");
      record(run, "repeat", `The buyer asked to order ${a.ref} again; rebuilt by plain code, no model.`, { ref: a.ref });
      return openNeed(run, rep.need, words ?? r.text ?? rep.memoryLine, { ref: `${run.turnId}:repeat`, memoryLine: rep.memoryLine });
    }
    case "remember":
    case "retry":
      return [];
    default:
      // Widget actions run in server/thread/widgets.ts (engine.ts routes them there).
      return [];
  }
}
