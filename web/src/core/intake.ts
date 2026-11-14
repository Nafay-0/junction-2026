import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL, type MeteredCatalog, type Product } from "./catalog";
import { facetsOf } from "./catalog/search";
import { OPTIMISE_QUESTION_ID, answerSchema, clarify, hardConstraints, kindMismatch, optimiseQuestion, optionLabel, violation, type Answer, type ConstraintSource, type MemoryNote, type Question } from "./clarify";
import { baseAmount, checkNeed, type CheckContext, type Concern, type ConcernCode } from "./concerns";
import { DockError, parse } from "./errors";
import {
  addStatedPreference,
  emptyProfile,
  kitchenView,
  lastOrder,
  learnPreferences,
  primaryLine,
  recordOrder,
  statedFor,
  type HistoryEntry,
  type KitchenProfile,
  type KitchenRepository,
  type StatedPreference,
  formatDay,
  localDateOf,
} from "./kitchen";
import type { Ledger } from "./ledger";
import { NeedSchema, SPEC_DIMENSIONS, applyNeedPatch, describeNeed, dimensionValue, formatAmount, normaliseNeed, type BaseUnit, type OptimiseGoal, type StructuredNeed } from "./need";
import { LABEL_TEXT, MAX_CARDS, buildOptions, formatCutoff, preselect, shortlist, type Exclusion, type OptionCard, type OptionLabel, type Reference } from "./options";
import type { AgentSession, DockRepository, LiveLookupResult, Order, PurchaseRequest } from "./orders";
import type { Decision } from "./policy";
import type { Quote, QuoteRequestLine } from "./quote";
import { describeSecondReading, readerName, readingConcerns, type SecondReadingRecord } from "./second-reading";
import { formatEur, newId } from "./util";

/**
 * The buyer-side intake: from a structured need to a signed quote, as explicit states.
 *
 *   needs_confirmation  a concern (likely mistake) blocks; confirm it or tap a correction
 *   needs_input         a few typed questions with fixed options
 *   options_ready       labelled option cards with pros and cons; choose one
 *   quoted              the wholesaler signed a quote; place the order with POST /api/v1/orders as before
 *   no_options          nothing meets the constraints; the response says why
 *   cancelled           the buyer cancelled (e.g. a duplicate)
 *
 * Every transition is written to the ledger. No free text in, no free text out: only typed structures.
 */

export type IntakeState = "needs_confirmation" | "needs_input" | "options_ready" | "quoted" | "no_options" | "cancelled";

/**
 * How a person's answer reached Dock. Only a channel that identifies the person makes it theirs:
 *   portal_session        the kitchen's signed-in portal session (a visitor's passkey-backed phone)
 *   approver_passkey      the approver's passkey on the sign-off screen
 *   protocol_elicitation  the protocol's own human-input mechanism (MCP elicitation: the client asked the user)
 *   voice                 the caller's own words on a voice call tied to their signed-in session
 *   relayed               anything an agent merely passes on (the default): recorded as "relayed by the agent, not
 *                         verified"; where the concern matters, the order then goes to a named person's sign-off
 * Set only by server code in this process (see server/console-context.ts), never from a request field.
 */
export type InputChannel = "portal_session" | "approver_passkey" | "protocol_elicitation" | "voice" | "relayed";
export type HumanVia = { channel: InputChannel; /** The identified person's name, when the channel names one. */ person?: string; /** What the person said, for the ledger (voice). */ words?: string };
export const RELAYED: HumanVia = { channel: "relayed" };
const isVerified = (v: HumanVia) => v.channel !== "relayed";
const CHANNEL_TEXT: Record<InputChannel, string> = {
  portal_session: "in the kitchen's signed-in portal",
  approver_passkey: "with their passkey",
  protocol_elicitation: "through the client's own prompt to the user (MCP elicitation)",
  voice: "on a voice call from their signed-in phone",
  relayed: "relayed by the agent, not verified",
};

/**
 * Concerns whose confirmation decides something a person must own: an unusual amount, a request against a stated or
 * remembered rule, a likely duplicate. Confirmed through a relayed channel, they do not let the agent decide alone:
 * the order goes to a named person's sign-off with the concern shown.
 */
export const CONFIRMATION_MATTERS: readonly ConcernCode[] = ["quantity_tenfold", "quantity_unusual", "unit_confusion", "contradicts_preference", "duplicate_recent", "declined_before", "breaks_remembered_rule", "standing_order_range"];

export type Acknowledgement = { key: string; code: ConcernCode; action: "confirmed" | "corrected" | "cancelled"; correctionId?: string; by: string; at: string; channel?: InputChannel; verified?: boolean };

/** A confirmation that matters but reached Dock only as the agent's word: a person signs the order off. */
export type UnverifiedConfirmation = { key: string; code: ConcernCode; message: string; by: string; at: string };

export type Intake = {
  requestId: string;
  orgId: string;
  agentId: string;
  state: IntakeState;
  family: string;
  need: StructuredNeed;
  originalNeed: StructuredNeed;
  amount?: { amount: number; unit: BaseUnit };
  acknowledgements: Acknowledgement[];
  suspendedPreferenceIds: string[];
  answers: (Answer & { by: string; at: string })[];
  concerns: Concern[];
  questions: Question[];
  /** Choices the buyer left open that the cards span (fat content, say). Not asked; answering them narrows the options. */
  openChoices?: Question[];
  fromMemory: MemoryNote[];
  notAsked: string[];
  /** The hard rules every option obeys, and where each came from (mandate, request, a person's stated preference). */
  rules: ConstraintSource[];
  options: OptionCard[];
  preselected?: { optionId: string; reason: string; source: "request" | "answer" | "stated" | "learned" };
  notes: string[];
  excluded: Exclusion[];
  /** Plausibility warnings not asked of the buyer because a person signs the order off anyway: shown to that person. */
  signOffNotes?: string[];
  /** Confirmations that matter but were only relayed by the agent: the order needs a person's sign-off (policy human_confirmation). */
  unverified?: UnverifiedConfirmation[];
  chosen?: { optionId: string; labels: OptionLabel[]; by: string; at: string };
  quote?: { quote: Quote; quoteToken: string; policyPreview: Decision };
  /** The buyer's words read a second time by an independent model (core/second-reading.ts): what it found. */
  secondReading?: SecondReadingRecord;
  createdAt: string;
  updatedAt: string;
};

export interface IntakeRepository {
  get(requestId: string): Promise<Intake | undefined>;
  save(intake: Intake): Promise<void>;
}

export class InMemoryIntakeRepository implements IntakeRepository {
  private items = new Map<string, Intake>();
  async get(id: string) {
    const i = this.items.get(id);
    return i && structuredClone(i);
  }
  async save(i: Intake) {
    this.items.set(i.requestId, structuredClone(i));
  }
}

// ---------- inputs ----------

/** `by` names the person the agent is relaying for; it goes into the ledger with every answer and confirmation. */
const by = z.string().min(1).max(120);
export const OpenIntakeInput = z.object({ need: z.unknown(), by: by.optional() });
export const ConcernResponseInput = z.object({
  by,
  responses: z.array(z.object({ key: z.string().min(1), choice: z.string().min(1) })).min(1).max(20), // "confirm" or a correction id
});
export const AnswersInput = z.object({ by, answers: z.array(answerSchema).min(1).max(10) });
export const ChoiceInput = z.object({ by, optionId: z.string().min(1) });

export type IntakeDeps = {
  catalog: MeteredCatalog;
  repo: DockRepository;
  kitchens: KitchenRepository;
  intakes: IntakeRepository;
  ledger: Ledger;
  now: () => Date;
  openRequest: (session: AgentSession, input: { text: string; neededBy?: string; productIds?: string[]; category?: string }) => Promise<PurchaseRequest>;
  requestQuote: (session: AgentSession, input: { requestId: string; lines: QuoteRequestLine[] }) => Promise<{ quote: Quote; quoteToken: string; policyPreview: Decision }>;
  spentThisWeek: (orgId: string) => Promise<number>;
  /** Committed and held spend, with the orders holding money, for the budget's part of a "nothing fits" answer. */
  budgetUse?: (orgId: string) => Promise<{ spentCents: number; heldCents: number; held: { orderId: string; totalCents: number; expiresAt: string }[] }>;
  /** The order flow's live lookup: allowance, delivery date, signed claims and ledger in one place (see orders.ts). */
  liveLookup: (session: AgentSession, requestId: string, productIds: string[], deliveryDate: string | undefined, why: string) => Promise<LiveLookupResult>;
  /**
   * The second reading of these words, if the interpreter made one (server/agent/second-reading-store.ts): looked up
   * by the kitchen and the buyer's own words. It can only add a question; nothing else here reads it.
   */
  secondReading?: (orgId: string, text: string | undefined) => SecondReadingRecord | undefined;
};

/** Who settled the goal. Only a goal the buyer gave (now or as a stated rule) lets the agent choose a card alone. */
const DECIDING_SOURCES = new Set(["request", "answer", "stated"]);

export type IntakeView = ReturnType<typeof view>;

export function createIntakeFlow(deps: IntakeDeps) {
  const { catalog, repo, kitchens, intakes, ledger, now } = deps;
  const agentActor = (s: AgentSession) => `agent:${s.agentId}`;
  const buyerActor = (who: string) => `buyer:${who}`;

  async function profileOf(session: AgentSession): Promise<KitchenProfile> {
    return (await kitchens.getProfile(session.mandate.issuer.orgId)) ?? emptyProfile(session.mandate.issuer.orgId, session.mandate.issuer.name);
  }

  async function own(session: AgentSession, requestId: string): Promise<Intake> {
    const i = await intakes.get(requestId);
    if (!i || i.orgId !== session.mandate.issuer.orgId || i.agentId !== session.agentId) {
      throw new DockError(404, "intake_not_found", `No intake ${requestId} for this agent. Start one with POST /api/v1/intake.`);
    }
    return i;
  }

  function expectState(i: Intake, states: IntakeState[], what: string) {
    if (!states.includes(i.state)) throw new DockError(409, "intake_wrong_state", `Cannot ${what} now: request ${i.requestId} is ${i.state}.`, "intake_sequence", { state: i.state });
  }

  /** Master data of the family, already narrowed to the claims the request requires (a local search, no live call). */
  async function familyProducts(family: string, need: StructuredNeed): Promise<Product[]> {
    const attributes = [...new Set([...need.requiredClaims, ...need.item.attributes])];
    let hits = await catalog.searchProducts({ category: family, ...(attributes.length ? { attributes } : {}), limit: 100 });
    // Nothing carries every claim: look at the whole family, so the answer can say why each product does not fit.
    if (hits.length === 0 && attributes.length) hits = await catalog.searchProducts({ category: family, limit: 100 });
    // A named product is always considered, even when it lacks a claim: the concerns say why it cannot be had.
    if (need.item.productId && !hits.some((p) => p.id === need.item.productId)) hits.push(...(await catalog.searchProducts({ ids: [need.item.productId], limit: 1 })));
    return hits;
  }

  async function resolveFamily(need: StructuredNeed, profile: KitchenProfile): Promise<string> {
    if (need.item.category) return need.item.category;
    if (need.item.productId) {
      const [p] = await catalog.searchProducts({ ids: [need.item.productId], limit: 1 });
      if (p) return p.category;
    }
    const hits = await catalog.searchProducts({ text: need.item.text, limit: 100 });
    const counts = new Map<string, number>();
    for (const p of hits) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top) return top[0];
    if (need.sameAsLastTime && profile.history.length) return profile.history.at(-1)!.family;
    throw new DockError(422, "family_unknown", `No product family matches "${need.item.text}". Send item.category (for example "milk").`);
  }

  function log(i: Intake, actor: string, summary: string, data: Record<string, unknown> = {}) {
    ledger.append({ type: "intake", actor, requestId: i.requestId, summary, data });
  }

  /** Run the checks and move the intake to its next state. */
  async function advance(session: AgentSession, i: Intake): Promise<Intake> {
    const at = now();
    const profile = await profileOf(session);
    const products = await familyProducts(i.family, i.need);
    const ctx: CheckContext = { now: at, profile, family: i.family, candidates: products, suspendedPreferenceIds: i.suspendedPreferenceIds };
    Object.assign(i, { concerns: [], questions: [], openChoices: [], fromMemory: [], notAsked: [], rules: [], options: [], notes: [], excluded: [], preselected: undefined, signOffNotes: undefined, updatedAt: at.toISOString() });
    if (i.unverified?.length) i.signOffNotes = i.unverified.map(unverifiedNote);

    // 1. Likely mistakes block everything else. Plausibility warnings a sign-off would show anyway wait (step 6).
    //    First the second reading: two independent readers that read a field differently ask about that field
    //    before anything else is checked on it.
    const acked = new Set(i.acknowledgements.map((a) => a.key));
    const readings = readingConcerns(i.need, i.secondReading).filter((c) => !acked.has(c.key));
    if (readings.length) return needsConfirmation(i, readings, "before any price lookup: two independent readers read the request differently");
    const open = checkNeed(i.need, ctx).filter((c) => !acked.has(c.key));
    const blocking = open.filter((c) => !c.deferrable);
    const deferred = open.filter((c) => c.deferrable);
    if (blocking.length) return needsConfirmation(i, blocking, "before any price lookup");
    i.amount = baseAmount(i.need, ctx) ?? (i.need.sameAsLastTime ? lastAmount(profile, i.family) : undefined);
    if (!i.amount) throw new DockError(422, "amount_unknown", "Could not work out the amount in litres, kilos or pieces.");

    // 2. Hard constraints: mandate, request, stated preferences, and the kind of product asked for.
    const stated = statedFor(profile, i.family);
    const constraints = hardConstraints(session.mandate, i.need, stated, i.suspendedPreferenceIds);
    i.rules = constraints.sources;
    const wantedKinds = facetsOf(`${i.need.item.text} ${i.family}`);
    const allowed = products.filter((p) => {
      const why = violation(p, constraints) ?? kindMismatch(p, wantedKinds);
      if (why) i.excluded.push({ productId: p.id, reason: why });
      return !why;
    });
    const learned = learnPreferences(profile, i.family);
    const last = lastOrder(profile, i.family);
    const usual = learned.find((l) => l.kind === "product");
    const budget = deps.budgetUse ? await deps.budgetUse(i.orgId) : { spentCents: await deps.spentThisWeek(i.orgId), heldCents: 0, held: [] };
    const spent = budget.spentCents;
    const reference = referenceFor(i.need, allowed, last, usual);

    // 3. "Same as last time" settles every choice from the last order; otherwise ask only what matters and memory
    //    does not answer.
    let narrowed: Product[];
    let span: ((p: Product) => string | undefined) | undefined;
    let goal: { optimise?: OptimiseGoal | "no_preference"; within?: number; source?: string } = {};
    const repeat = i.need.sameAsLastTime && last && reference?.source === "last" ? allowed.find((p) => p.id === reference.productId) : undefined;
    if (i.need.sameAsLastTime && last && !repeat) {
      const why = i.excluded.find((e) => e.productId === primaryLine(last).productId)?.reason ?? "not in the catalogue now";
      i.notes.push(`Same as last time (${primaryLine(last).name}) is not possible: ${why}. Here are the options instead.`);
    }
    if (repeat) {
      const spec = SPEC_DIMENSIONS.map((d) => [d, dimensionValue(d, repeat.attributes)] as const);
      narrowed = allowed.filter((p) => spec.every(([d, v]) => v === undefined || dimensionValue(d, p.attributes) === v));
      goal = goalFromMemory(i.need, stated, learned);
    } else {
      const c = clarify({ need: i.need, candidates: allowed, stated, learned, answers: i.answers, suspended: i.suspendedPreferenceIds });
      i.fromMemory = c.fromMemory;
      i.notAsked = c.notAsked;
      if (c.questions.length) {
        i.state = "needs_input";
        i.questions = c.questions;
        log(i, "dock", `Dock asked ${c.questions.length} question${c.questions.length > 1 ? "s" : ""}: ${c.questions.map((q) => q.text).join(" / ")}`, {
          step: "questions",
          questions: c.questions.map((q) => ({ id: q.id, options: q.options.map((o) => o.id) })),
          reasons: memoryText(i, c.fromMemory).map((t) => `From memory: ${t}`),
        });
        await intakes.save(i);
        return i;
      }
      narrowed = allowed.filter((p) => c.settled.attributes.every((a) => p.attributes.includes(a)) && !c.settled.excludedAttributes.some((a) => p.attributes.includes(a)));
      i.openChoices = c.spanned;
      const openDims = c.spanned.map((q) => SPEC_DIMENSIONS.find((d) => d.id === q.dimension)!).filter(Boolean);
      if (openDims.length) span = (p) => openDims.map((d) => dimensionValue(d, p.attributes) ?? "?").join("|");
      goal = { optimise: c.settled.optimise, within: c.settled.optimiseWithinPctOfCheapest, source: c.settled.optimiseSource };
    }
    if (narrowed.length === 0) return noOptions(i, allowed.length ? "No product matches the answers given." : "No product in this family meets the mandate, the request and the kitchen's stated rules.");

    // 4. Live prices for a short list only (one call), then the option cards.
    const prefer = [reference?.productId, last && primaryLine(last).productId, usual?.kind === "product" ? usual.productId : undefined];
    const short = shortlist(narrowed, prefer, MAX_LIVE_IDS_PER_CALL, i.amount, span);
    const live = await deps.liveLookup(session, i.requestId, short.map((p) => p.id), i.need.deliverBy, "Dock checked live price and availability for the shortlist");
    const goalForRank = goal.optimise && goal.optimise !== "no_preference" ? goal.optimise : undefined;
    const options = (priced: Product[], l: Pick<LiveLookupResult, "offers" | "statuses">) => buildOptions({
      amount: i.amount!,
      candidates: priced,
      offers: l.offers,
      statuses: l.statuses,
      mandate: session.mandate,
      now: at,
      neededBy: i.need.deliverBy,
      spentThisWeekCents: spent,
      heldThisWeekCents: budget.heldCents,
      last,
      usual: usual?.kind === "product" ? { productId: usual.productId, text: usual.text } : undefined,
      reference,
      goal: goalForRank,
      span,
      estimates: i.acknowledgements.filter((a) => a.code === "pack_uncertain" && a.action === "confirmed").map((a) => a.key.split(":")[1]),
    });
    let result = options(short, live);
    // One second chance, never more: when the short list leaves gaps (cut-offs passed, stock short, a kind the buyer
    // left open with no card), price the next few products once rather than offer less than the catalogue has.
    const covered = new Set(result.cards.map((c) => span?.(short.find((p) => p.id === c.lines[0].productId)!)));
    const uncovered = span ? new Set(narrowed.map(span).filter((k) => k && !k.includes("?") && !covered.has(k))) : new Set<string>();
    const rest = narrowed.filter((p) => !short.includes(p));
    if (rest.length && (result.cards.length < MAX_CARDS || uncovered.size)) {
      const wanted = rest.filter((p) => uncovered.has(span?.(p) ?? ""));
      const pool = shortlist(wanted.length ? wanted : rest, [], MAX_LIVE_IDS_PER_CALL, i.amount, span);
      const second = await deps.liveLookup(session, i.requestId, pool.map((p) => p.id), i.need.deliverBy, "The first short list left gaps; Dock checked the next few products once");
      short.push(...pool);
      result = options(short, { offers: [...live.offers, ...second.offers], statuses: [...live.statuses, ...second.statuses] });
    }
    i.notes.push(...result.notes, ...i.notAsked);
    i.excluded.push(...result.excluded);
    if (result.cards.length === 0) return noOptions(i, noOptionReason(result.excluded, i.need.deliverBy, { mandate: session.mandate, ...budget }));
    i.options = result.cards;
    // A confirmation that matters came only as the agent's word: every card says a named person will sign it.
    if (i.unverified?.length) for (const card of i.options) card.signOff.push(`The agent relayed a confirmation nobody verified (${i.unverified.map((u) => u.code).join(", ")}): a person must sign this order off.`);

    // 5. Plausibility warnings: if every option goes to a person for sign-off anyway, that person sees the warning
    //    with the order; the buyer is not asked twice. Otherwise ask now, before anything is chosen.
    // A first order has nothing to compare with: its size is shown on every card and to whoever signs it off,
    // never a blocking step (a hotel ordering 1,000 L is ordinary, and the buyer said it in words).
    for (const c of deferred.filter((x) => x.code === "large_first_order")) {
      for (const card of i.options) card.cons.push(c.message);
      (i.signOffNotes ??= []).push(`Check the amount: ${c.message}`);
      log(i, "dock", `Dock did not stop the buyer for large_first_order: it is a note on every option${i.options.some((o) => o.totalCents > session.mandate.perOrderLimitCents) ? " and goes to the person signing off" : ""}.`, { step: "noted", concerns: [{ key: c.key, code: c.code }], reasons: [c.message] });
    }
    const ask = deferred.filter((x) => x.code !== "large_first_order");
    if (ask.length) {
      const limit = session.mandate.perOrderLimitCents;
      if (result.cards.every((c) => c.totalCents > limit)) {
        (i.signOffNotes ??= []).push(...ask.map((c) => `Check the amount: ${c.message} (not asked before ordering, because a person signs this order off anyway).`));
        log(i, "dock", `Dock did not stop the buyer for ${ask.map((c) => c.code).join(", ")}: every option is over the ${formatEur(limit)} the agent may spend alone, so the person signing it off sees it.`, {
          step: "carried_to_sign_off",
          concerns: ask.map((c) => ({ key: c.key, code: c.code })),
          reasons: i.signOffNotes,
        });
      } else {
        i.options = [];
        return needsConfirmation(i, ask, "before an option is chosen: one of the options is within what the agent may spend alone, so no one else would look at it");
      }
    }

    // 6. Choose. Same as last time, or the goal the buyer gave, picks a full match without asking. A learned habit
    //    only pre-selects, and a compromise is always the buyer's call.
    const repeatCard = repeat && i.options.find((o) => o.match === "full" && o.lines.length === 1 && o.lines[0].productId === repeat.id);
    if (repeatCard) {
      i.notes.unshift(`Repeats your order of ${formatAmount(last!.amount, last!.unit)} from ${formatDay(localDateOf(last!.placedAt))}.`);
      return quoteOption(session, i, { ...repeatCard, labels: ["same_as_last_time"] }, `agent ${session.agentId}`, "Same as last time, as asked.");
    }
    const pick = goalForRank ? preselect(i.options, goalForRank, goal.within) : undefined;
    if (pick && goal.source) i.preselected = { ...pick, source: goal.source as NonNullable<Intake["preselected"]>["source"] };
    const picked = i.preselected && i.options.find((o) => o.optionId === i.preselected!.optionId);
    log(i, "dock", `Dock offered ${i.options.length} option${i.options.length > 1 ? "s" : ""} for ${formatAmount(i.amount.amount, i.amount.unit)} of ${i.family} (${i.options.every((o) => o.match === "full") ? "all full matches, ranked" : "none meets the whole request; each says what it gives up"})${i.preselected ? `; pre-selected ${i.preselected.optionId} (${i.preselected.reason})` : ""}.`, {
      step: "options",
      reasons: [...i.options.map(cardLine), ...result.excluded.filter((e) => e.code === "cutoff_passed").map((e) => `${e.productId}: ${e.reason}`), ...memoryText(i, i.fromMemory).map((t) => `From memory: ${t}`)],
      options: i.options.map((o) => ({ optionId: o.optionId, rank: o.rank, match: o.match, givesUp: o.givesUp.map((g) => g.part), labels: o.labels, totalCents: o.totalCents, lines: o.quoteLines })),
      excluded: i.excluded,
    });
    // The cards differ on something the buyer left open (fat content): that choice is theirs, so the agent waits.
    const openOnCards = !!span && new Set(i.options.map((o) => span(short.find((p) => p.id === o.lines[0].productId)!))).size > 1;
    if (picked && picked.match === "full" && DECIDING_SOURCES.has(i.preselected!.source) && !openOnCards) {
      return quoteOption(session, i, picked, `agent ${session.agentId}`, `${i.preselected!.reason} It meets the whole request, so the agent chose it without asking.`);
    }
    i.state = "options_ready";
    await intakes.save(i);
    return i;
  }

  async function needsConfirmation(i: Intake, concerns: Concern[], when: string): Promise<Intake> {
    i.state = "needs_confirmation";
    i.concerns = concerns;
    log(i, "dock", `Dock found ${concerns.length} thing${concerns.length > 1 ? "s" : ""} to check ${when}.`, {
      step: "concerns",
      reasons: concerns.map((c) => `${c.code}: ${c.message}`),
      concerns: concerns.map((c) => ({ key: c.key, code: c.code, severity: c.severity })),
    });
    await intakes.save(i);
    return i;
  }

  function memoryText(i: Intake, fromMemory: MemoryNote[]): string[] {
    return [
      ...i.rules.filter((r) => r.source === "stated").map((r) => r.text),
      ...fromMemory.map((m) => `${m.question.text} ${m.label} (${m.source === "stated" ? "stated earlier" : "learned, pre-selected"})`),
    ];
  }

  async function noOptions(i: Intake, reason: string): Promise<Intake> {
    i.state = "no_options";
    i.notes.unshift(reason);
    log(i, "dock", `Dock found no option: ${reason}`, { step: "no_options", reasons: i.excluded.map((e) => `${e.productId}: ${e.reason}`) });
    await intakes.save(i);
    return i;
  }

  async function quoteOption(session: AgentSession, i: Intake, card: OptionCard, who: string, reason?: string, via: HumanVia = RELAYED): Promise<Intake> {
    const at = now().toISOString();
    const byAgent = who.startsWith("agent ");
    const verified = isVerified(via);
    log(i, byAgent || !verified ? agentActor(session) : buyerActor(who), `${who} chose ${card.optionId}${byAgent ? "" : ` (${howText(via)})`} (${card.labels.map((l) => LABEL_TEXT[l]).join(", ")}): ${cardLine(card)}${reason ? ` ${reason}` : ""}`, {
      channel: byAgent ? undefined : via.channel,
      verified: byAgent ? undefined : verified,
      step: "choice",
      optionId: card.optionId,
      labels: card.labels,
      lines: card.quoteLines,
      by: who,
      relayedBy: session.agentId,
    });
    await intakes.save(i); // the gate's preview reads what the intake knows (an unverified confirmation, say)
    const quoted = await deps.requestQuote(session, { requestId: i.requestId, lines: card.quoteLines });
    i.chosen = { optionId: card.optionId, labels: card.labels, by: who, at };
    i.quote = quoted;
    i.state = "quoted";
    i.updatedAt = at;
    await intakes.save(i);
    return i;
  }

  return {
    /** Start from a structured need. Returns the first state. */
    async open(session: AgentSession, input: z.input<typeof OpenIntakeInput>): Promise<IntakeView> {
      const body = parse(OpenIntakeInput, input);
      const { need, changes } = normaliseNeed(parse(NeedSchema, body.need));
      const profile = await profileOf(session);
      const family = await resolveFamily(need, profile);
      if (need.sameAsLastTime && !need.quantity && !lastOrder(profile, family)) {
        throw new DockError(422, "nothing_to_repeat", `There is no earlier ${family} order to repeat. Send a quantity to see the options.`);
      }
      // What was asked for, for the gate: the product the buyer named, and the family. Anything else ordered under
      // this request is a substitute of it, whatever the agent declares (policy substitution_rule).
      const request = await deps.openRequest(session, { text: need.text ?? describeNeed(need), neededBy: need.deliverBy, ...(need.item.productId ? { productIds: [need.item.productId] } : {}), category: family });
      const at = now().toISOString();
      const i: Intake = {
        requestId: request.requestId,
        orgId: request.orgId,
        agentId: session.agentId,
        state: "needs_input",
        family,
        need,
        originalNeed: need,
        acknowledgements: [],
        suspendedPreferenceIds: [],
        answers: [],
        concerns: [],
        questions: [],
        fromMemory: [],
        notAsked: [],
        rules: [],
        options: [],
        notes: [],
        excluded: [],
        createdAt: at,
        updatedAt: at,
      };
      log(i, agentActor(session), `Structured need (${family}): ${describeNeed(need)}.`, { step: "need", need, by: body.by, ...(changes.length ? { reasons: changes.map((c) => `In the catalogue's words: ${c}`) } : {}) });
      const second = deps.secondReading?.(request.orgId, need.text);
      if (second) {
        i.secondReading = second;
        log(i, "dock", describeSecondReading(second), {
          step: "second_reading",
          status: second.status,
          firstModel: second.firstModel,
          secondModel: second.secondModel,
          ...(second.secondMs !== undefined ? { secondMs: second.secondMs } : {}),
          ...(second.waitedMs !== undefined ? { waitedMs: second.waitedMs } : {}),
          ...(second.reason ? { reason: second.reason } : {}),
          differences: second.differences.map(({ field, first, second: s2, why }) => ({ field, first, second: s2, why })),
          ...(second.minor.length ? { reasons: second.minor } : {}),
        });
      }
      return view(await advance(session, i));
    },

    async get(session: AgentSession, requestId: string): Promise<IntakeView> {
      return view(await own(session, requestId));
    },

    /** Confirm a concern as intended, or take one of its corrections. */
    async respondToConcerns(session: AgentSession, requestId: string, input: z.input<typeof ConcernResponseInput>, via: HumanVia = RELAYED): Promise<IntakeView> {
      const { by: said, responses } = parse(ConcernResponseInput, input);
      const verified = isVerified(via);
      const who = verified && via.person ? via.person : said;
      const actor = verified ? buyerActor(who) : agentActor(session);
      const how = howText(via);
      const i = await own(session, requestId);
      expectState(i, ["needs_confirmation"], "respond to concerns");
      const at = now().toISOString();
      const neededBefore = i.need.deliverBy;
      for (const r of responses) {
        const c = i.concerns.find((x) => x.key === r.key);
        if (!c) throw new DockError(409, "concern_not_open", `No open concern ${r.key}.`, undefined, { open: i.concerns.map((x) => x.key) });
        if (r.choice === "confirm") {
          if (!c.confirmable) throw new DockError(409, "concern_not_confirmable", `${c.code} cannot be confirmed as is; choose one of: ${c.corrections.map((x) => x.id).join(", ") || "(none: start a new request)"}.`);
          i.acknowledgements.push({ key: c.key, code: c.code, action: "confirmed", by: who, at, channel: via.channel, verified });
          i.suspendedPreferenceIds.push(...(c.preferenceIds ?? []));
          const matters = !verified && CONFIRMATION_MATTERS.includes(c.code);
          if (matters) (i.unverified ??= []).push({ key: c.key, code: c.code, message: c.message, by: who, at });
          const summary = verified
            ? `${who} confirmed as intended, ${how}: ${c.message}`
            : `Relayed by the agent, not verified: it says ${who} meant it this way: ${c.message}${matters ? " Nobody verified that, so the order cannot be decided by the agent alone: a named person signs it off, with this shown." : ""}`;
          log(i, actor, summary, { step: "confirmation", key: c.key, code: c.code, by: who, relayedBy: session.agentId, channel: via.channel, verified, ...(via.words ? { words: via.words } : {}), ...(matters ? { needsSignOff: true } : {}), suspendedPreferenceIds: c.preferenceIds });
          continue;
        }
        const fix = c.corrections.find((x) => x.id === r.choice);
        if (!fix) throw new DockError(400, "correction_unknown", `Concern ${c.key} has no correction ${r.choice}; use "confirm"${c.confirmable ? "" : " (not allowed here)"} or one of: ${c.corrections.map((x) => x.id).join(", ")}.`);
        if (fix.cancel) {
          i.acknowledgements.push({ key: c.key, code: c.code, action: "cancelled", correctionId: fix.id, by: who, at, channel: via.channel, verified });
          i.state = "cancelled";
          i.concerns = [];
          i.updatedAt = at;
          log(i, actor, `${who} cancelled the request (${how}): ${fix.label}.`, { step: "cancelled", key: c.key, code: c.code, by: who, relayedBy: session.agentId, channel: via.channel, verified });
          await intakes.save(i);
          return view(i);
        }
        const before = describeNeed(i.need);
        i.need = applyNeedPatch(i.need, fix.patch ?? {});
        i.acknowledgements.push({ key: c.key, code: c.code, action: "corrected", correctionId: fix.id, by: who, at, channel: via.channel, verified });
        log(i, actor, `${who} corrected ${c.code} (${how}): ${fix.label}.`, { step: "correction", key: c.key, code: c.code, correctionId: fix.id, by: who, relayedBy: session.agentId, channel: via.channel, verified, ...(via.words ? { words: via.words } : {}), before, after: describeNeed(i.need) });
      }
      if (i.need.deliverBy !== neededBefore) {
        const req = await repo.getRequest(requestId);
        if (req) await repo.saveRequest({ ...req, neededBy: i.need.deliverBy });
      }
      return view(await advance(session, i));
    },

    /** Answer questions (or change an answer that memory pre-selected). `remember` stores it as a stated preference. */
    async answer(session: AgentSession, requestId: string, input: z.input<typeof AnswersInput>, via: HumanVia = RELAYED): Promise<IntakeView> {
      const { by: said, answers } = parse(AnswersInput, input);
      const verified = isVerified(via);
      const who = verified && via.person ? via.person : said;
      const how = howText(via);
      const i = await own(session, requestId);
      expectState(i, ["needs_input", "options_ready"], "answer questions");
      // The goal can always be given (or changed): it is never asked up front, the cards answer it.
      const askable = [...i.questions, ...(i.openChoices ?? []), ...i.fromMemory.map((m) => m.question), ...(i.fromMemory.some((m) => m.question.id === OPTIMISE_QUESTION_ID) ? [] : [optimiseQuestion()])];
      const at = now().toISOString();
      let profile = await profileOf(session);
      const notRemembered: string[] = [];
      for (const a of answers) {
        const q = askable.find((x) => x.id === a.questionId);
        if (!q) throw new DockError(409, "question_not_open", `Question ${a.questionId} is not open.`, undefined, { open: askable.map((x) => x.id) });
        if (!q.options.some((o) => o.id === a.optionId)) throw new DockError(400, "option_unknown", `${a.optionId} is not an option of ${q.id}: ${q.options.map((o) => o.id).join(", ")}.`);
        i.answers.push({ ...a, by: who, at });
        let remembered = "";
        if (a.remember && verified) {
          const pref = rememberAnswer(q, a.optionId, i, who, at);
          profile = addStatedPreference(profile, pref);
          remembered = ` Remembered for next time as "${pref.text}".`;
        } else if (a.remember) {
          // A rule of the kitchen is a person's word. An answer only relayed by an agent applies to this request.
          remembered = " Not stored as a kitchen rule: an answer relayed by the agent cannot set one; the kitchen can state it on its memory page.";
          notRemembered.push(`"${optionLabel(q, a.optionId)}" applies to this request only: an answer relayed by the agent is not stored as a kitchen rule.`);
        }
        log(i, verified ? buyerActor(who) : agentActor(session), `${who} answered "${q.text}" (${how}): ${optionLabel(q, a.optionId)}.${remembered}`, { step: "answer", questionId: q.id, optionId: a.optionId, remember: !!a.remember && verified, by: who, relayedBy: session.agentId, channel: via.channel, verified, ...(via.words ? { words: via.words } : {}) });
      }
      await kitchens.saveProfile(profile);
      const next = await advance(session, i);
      if (notRemembered.length) {
        next.notes.push(...notRemembered);
        await intakes.save(next);
      }
      return view(next);
    },

    /** Choose an option card: Dock asks the wholesaler for a signed quote and runs the policy preview. */
    async choose(session: AgentSession, requestId: string, input: z.input<typeof ChoiceInput>, via: HumanVia = RELAYED): Promise<IntakeView> {
      const { by: said, optionId } = parse(ChoiceInput, input);
      const verified = isVerified(via);
      const who = verified && via.person ? via.person : said;
      const i = await own(session, requestId);
      expectState(i, ["options_ready"], "choose an option");
      const card = i.options.find((o) => o.optionId === optionId);
      if (!card) throw new DockError(404, "option_not_found", `No option ${optionId}; choose one of ${i.options.map((o) => o.optionId).join(", ")}.`);
      if (card.givesUp.some((g) => g.part === "delivery_date")) {
        // Choosing a later day is the buyer moving their own deadline: the request and the gate follow it.
        const before = i.need.deliverBy;
        i.need = applyNeedPatch(i.need, { deliverBy: card.deliveryDate });
        const req = await repo.getRequest(requestId);
        if (req) await repo.saveRequest({ ...req, neededBy: card.deliveryDate });
        log(i, verified ? buyerActor(who) : agentActor(session), `${who} accepted a later delivery (${howText(via)}): ${card.deliveryDate} instead of ${before}.`, { step: "compromise", optionId, givesUp: card.givesUp, by: who, relayedBy: session.agentId, channel: via.channel, verified });
      }
      return view(await quoteOption(session, i, card, who, undefined, via));
    },

    async kitchen(session: AgentSession) {
      return kitchenView(await profileOf(session));
    },
  };
}

function howText(via: HumanVia): string {
  return via.words ? `${CHANNEL_TEXT[via.channel]}, in their words: "${via.words.slice(0, 200)}"` : CHANNEL_TEXT[via.channel];
}

function unverifiedNote(u: UnverifiedConfirmation): string {
  return `Not verified: the agent relayed that ${u.by} confirmed this as intended. Check it before signing: ${u.message}`;
}

/** The product the request is about, if any: named, repeated, or the kitchen's usual (a habit, not a requirement). */
function referenceFor(need: StructuredNeed, allowed: Product[], last: HistoryEntry | undefined, usual: ReturnType<typeof learnPreferences>[number] | undefined): Reference | undefined {
  if (need.item.productId) {
    const p = allowed.find((x) => x.id === need.item.productId);
    return p && { productId: p.id, name: p.name, source: "named" };
  }
  if (need.sameAsLastTime && last) {
    const l = primaryLine(last);
    return { productId: l.productId, name: l.name, source: "last" };
  }
  if (usual?.kind === "product" && allowed.some((p) => p.id === usual.productId)) return { productId: usual.productId, name: usual.name, source: "usual" };
  return undefined;
}

/** The goal from the request, a stated rule or a learned habit, without asking (for "same as last time"). */
function goalFromMemory(need: StructuredNeed, stated: StatedPreference[], learned: ReturnType<typeof learnPreferences>): { optimise?: OptimiseGoal | "no_preference"; within?: number; source?: string } {
  if (need.optimise !== "unstated") return { optimise: need.optimise, source: "request" };
  const s = stated.find((p) => p.kind === "optimise");
  if (s && s.kind === "optimise") return { optimise: s.goal, within: s.withinPctOfCheapest, source: "stated" };
  const l = learned.find((p) => p.kind === "optimise");
  if (l && l.kind === "optimise") return { optimise: l.goal, source: "learned" };
  return {};
}

/**
 * Why nothing can be offered, naming the real blocker first. A product can be excluded for several reasons on the
 * way (out of stock, then too late); what decides is the last gate the best plans hit. The weekly budget and a
 * passed order cut-off lead whenever they removed an option, because the buyer can act on them (withdraw or sign
 * a waiting order, order earlier); then the reason that removed the most products.
 */
export function noOptionReason(
  excluded: Exclusion[],
  deliverBy: string | undefined,
  budget?: { mandate: { weeklyBudgetCents: number }; spentCents: number; heldCents: number; held: { orderId: string; totalCents: number; expiresAt: string }[] },
): string {
  if (!excluded.length) return "Nothing in stock can be delivered in time within the mandate.";
  const by = new Map<string, Exclusion[]>();
  for (const e of excluded) {
    if (e.code === "compromise") continue;
    const k = e.code ?? "other";
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  const overBudget = by.get("over_budget") ?? [];
  const cutoff = by.get("cutoff_passed") ?? [];
  const others = [...by.entries()].filter(([k]) => k !== "over_budget" && k !== "cutoff_passed").sort((a, b) => b[1].length - a[1].length);
  const parts: string[] = [];
  if (overBudget.length) {
    const b = budget;
    const committed = b ? b.spentCents - b.heldCents : undefined;
    const left = b && committed !== undefined ? Math.max(0, b.mandate.weeklyBudgetCents - committed) : undefined;
    parts.push(
      `the weekly budget: ${overBudget.length === 1 ? "the option that fits" : `${overBudget.length} options that fit`} would cost more than ${left !== undefined ? `the ${formatEur(left)} left of ${formatEur(b!.mandate.weeklyBudgetCents)} this week (${formatEur(committed!)} already committed)` : "is left this week"}${b && b.heldCents > 0 ? `, and ${formatEur(b.heldCents)} more is held by ${b.held.map((h) => h.orderId).join(", ")} waiting for sign-off: withdraw it or have it decided, or it stops holding money when its price expires` : ""}`,
    );
  }
  if (cutoff.length) parts.push(`the order cut-off has passed for ${cutoff.map((e) => e.productId).join(", ")}, so ${cutoff.length > 1 ? "they" : "it"} cannot arrive by ${deliverBy ?? "the date asked"}`);
  for (const [, list] of others) parts.push([...new Set(list.map((e) => `${e.productId}: ${e.reason}`))].slice(0, 2).join("; "));
  if (!parts.length) return "Nothing on the short list can be delivered in time within the mandate.";
  return `Nothing fits. The blocker is ${parts[0]}.${parts.length > 1 ? ` Also: ${parts.slice(1, 3).join("; ")}.` : ""}`;
}

function lastAmount(profile: KitchenProfile, family: string) {
  const l = lastOrder(profile, family);
  return l && { amount: l.amount, unit: l.unit };
}

function cardLine(c: OptionCard): string {
  const labels = c.labels.map((l) => LABEL_TEXT[l]).join(", ");
  const what = c.match === "full" ? `${c.rank}${labels ? `, ${labels}` : ""}` : `${c.rank} compromise, gives up ${c.givesUp.map((g) => g.part.replace("_", " ")).join(" and ")}`;
  return `[${what}] ${c.lines.map((l) => `${l.packs} x ${l.productId}${l.substituteFor ? ` (for ${l.substituteFor})` : ""}`).join(" + ")} for ${formatEur(c.totalCents)}, delivery ${c.deliveryDate}${c.orderBy ? ` if ordered by ${formatCutoff(c.orderBy)}` : ""}${c.stockConfirmed ? "" : ", stock not reported"}`;
}

function rememberAnswer(q: Question, optionId: string, i: Intake, who: string, at: string): StatedPreference {
  const common = { id: newId("pref"), family: i.family, statedBy: who, statedAt: at, requestId: i.requestId };
  if (q.kind === "optimise") {
    return { ...common, kind: "optimise", goal: optionId as "price", text: `For ${i.family}: ${optionLabel(q, optionId)}` };
  }
  const dim = SPEC_DIMENSIONS.find((d) => d.id === q.dimension)!;
  return { ...common, kind: "dimension", dimension: dim.id, choice: optionId, text: `For ${i.family}, ${dim.question.replace(/\?$/, "").toLowerCase()}: ${optionLabel(q, optionId)}` };
}

/** Add a committed order to the kitchen's history. Called by the order flow at commit. */
export async function recordCommittedOrder(deps: { kitchens: KitchenRepository; intakes: IntakeRepository }, order: Order, neededBy?: string): Promise<void> {
  const profile = (await deps.kitchens.getProfile(order.orgId)) ?? emptyProfile(order.orgId, order.orgName);
  const intake = await deps.intakes.get(order.requestId);
  const lines = order.lines.map((l) => ({ productId: l.productId, name: l.name, category: l.category, attributes: l.attributes, packs: l.quantity, packSize: l.packSize, unit: l.unit, unitPriceCents: l.unitPriceCents }));
  const main = [...lines].sort((a, b) => b.packs * b.packSize - a.packs * a.packSize)[0];
  const entry: HistoryEntry = {
    orderId: order.orderId,
    requestId: order.requestId,
    placedAt: order.updatedAt,
    neededBy,
    deliveryDate: order.lines.map((l) => l.deliveryDate).sort().at(-1)!,
    family: main.category,
    amount: Math.round(lines.filter((l) => l.unit === main.unit).reduce((s, l) => s + l.packs * l.packSize, 0) * 100) / 100,
    unit: main.unit,
    totalCents: order.totalCents,
    lines,
    chosenLabels: intake?.chosen?.labels,
  };
  await deps.kitchens.saveProfile(recordOrder(profile, entry));
}

/** What leaves Dock for an intake: the state, what to show, and the next call to make. */
export function view(i: Intake) {
  const base = `/api/v1/intake/${i.requestId}`;
  const next =
    i.state === "needs_confirmation"
      ? { method: "POST", path: `${base}/concerns`, example: { by: "<person>", responses: i.concerns.map((c) => ({ key: c.key, choice: c.corrections[0]?.id ?? "confirm" })) } }
      : i.state === "needs_input"
        ? { method: "POST", path: `${base}/answers`, example: { by: "<person>", answers: i.questions.map((q) => ({ questionId: q.id, optionId: q.options[0].id, remember: false })) } }
        : i.state === "options_ready"
          ? { method: "POST", path: `${base}/choice`, example: { by: "<person>", optionId: i.preselected?.optionId ?? i.options[0].optionId } }
          : i.state === "quoted"
            ? {
                method: "POST",
                path: "/api/v1/orders",
                example: { requestId: i.requestId, quoteToken: i.quote!.quoteToken, lines: i.quote!.quote.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) },
              }
            : { method: "POST", path: "/api/v1/intake", example: { need: "<a new structured need>" } };
  return {
    requestId: i.requestId,
    state: i.state,
    family: i.family,
    need: i.need,
    amount: i.amount,
    concerns: i.concerns,
    questions: i.questions,
    openChoices: i.openChoices ?? [],
    fromMemory: i.fromMemory,
    rules: i.rules,
    options: i.options,
    preselected: i.preselected,
    notes: i.notes,
    excluded: i.excluded,
    signOffNotes: i.signOffNotes ?? [],
    acknowledgements: i.acknowledgements,
    chosen: i.chosen,
    quote: i.quote,
    secondReading: i.secondReading && {
      status: i.secondReading.status,
      firstModel: i.secondReading.firstModel,
      secondModel: i.secondReading.secondModel,
      /** The readers in words, for the buyer. */
      readers: { first: readerName(i.secondReading.firstModel), second: readerName(i.secondReading.secondModel) },
      ...(i.secondReading.reason ? { reason: i.secondReading.reason } : {}),
      differences: i.secondReading.differences.map(({ field, first, second, why }) => ({ field, first, second, why })),
    },
    next,
  };
}
