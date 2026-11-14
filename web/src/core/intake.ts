import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL, scheduledOn, type LiveOffer, type MeteredCatalog, type Product } from "./catalog";
import { facetsOf } from "./catalog/search";
import { OPTIMISE_QUESTION_ID, answerSchema, clarify, hardConstraints, kindMismatch, optimiseQuestion, optionLabel, violation, type Answer, type ConstraintSource, type MemoryNote, type Question } from "./clarify";
import { proposedIds, type AlternativesAnswer, type AlternativesSource } from "./alternatives";
import { alsoAskedIn, alsoAskedNote, groupsIn, type AlsoAsked } from "./also-asked";
import { qualifiersOf } from "./qualifiers";
import { baseAmount, checkNeed, noticeNeed, type CheckContext, type Concern, type ConcernCode, type Noticed, type PendingOrderSummary } from "./concerns";
import { DockError, parse } from "./errors";
import {
  addDaysIso,
  addStatedPreference,
  declinedProducts,
  latestDeliveryDay,
  updateKitchenProfile,
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
 * How a person's answer reached Dock. Only a channel bound to the person makes it theirs:
 *   portal_session        the kitchen's signed-in portal session (a visitor's passkey-backed phone)
 *   approver_passkey      the approver's passkey on the sign-off screen
 *   voice                 the caller's own words on a voice call tied to their signed-in session
 *   answer_link           Dock's own answer page, opened through a one-time link Dock handed out for this request.
 *                         The words are Dock's fixed choices, not an agent's paraphrase, but whoever holds the link
 *                         can answer: it is the person's own answer only when their kitchen's signed-in session is
 *                         present on that page; without it, it is relayed
 *   protocol_elicitation  a form the agent's client showed (MCP elicitation). The client returns the answer, and Dock
 *                         cannot tell a client that asked its user from one that filled the form in itself: relayed
 *   relayed               anything an agent merely passes on (the default)
 * A relayed answer is recorded as relayed by the agent's client, never as the buyer's own. It may settle a
 * preference inside the mandate (which option, what matters most); it never satisfies a confirmation that matters:
 * the order then goes to a named person's sign-off.
 * Set only by server code in this process (see server/console-context.ts), never from a request field.
 */
export type InputChannel = "portal_session" | "approver_passkey" | "protocol_elicitation" | "voice" | "answer_link" | "relayed";
export type HumanVia = { channel: InputChannel; /** The identified person's name, when the channel names one. */ person?: string; /** What the person said, for the ledger (voice). */ words?: string };
export const RELAYED: HumanVia = { channel: "relayed" };
/**
 * A person identified by the channel: their passkey, or a session of the kitchen's own store that a passkey opened
 * (the store screen, a voice call from that phone, the answer page with that session on it). The assumption this
 * rests on, stated once: whoever holds that signed-in session is that person. Nothing a client reports counts.
 */
export const isVerified = (v: HumanVia) => v.channel === "approver_passkey" || ((v.channel === "portal_session" || v.channel === "voice" || v.channel === "answer_link") && !!v.person);
const CHANNEL_TEXT: Record<InputChannel, string> = {
  portal_session: "in the kitchen's signed-in portal",
  approver_passkey: "with their passkey",
  protocol_elicitation: "through a form the agent's client showed (MCP elicitation), not verified",
  voice: "on a voice call from their signed-in phone",
  answer_link: "on Dock's own answer page through a one-time link",
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
  /** Options the gate's own preview refuses: never offered, kept only to say why an obvious choice is missing. */
  refusedOptions?: OptionCard[];
  /** Noticed without asking (core/concerns.ts noticeNeed): an amount clearly outside the kitchen's range, a standing order that crept up. Said on the card and to whoever signs off. */
  noticed?: Noticed[];
  /** Confirmations that matter but were only relayed by the agent: the order needs a person's sign-off (policy human_confirmation). */
  unverified?: UnverifiedConfirmation[];
  /** Items the buyer's own words name that this request does not cover (plain code, see also-asked.ts): said, never dropped. */
  alsoAsked?: AlsoAsked[];
  /** The site within the kitchen the request is for, when a door knows it. */
  site?: string;
  /** One line per remembered thing this request used (a rule applied, a habit pre-selected, a check, a product left out). */
  memoryUsed?: { itemId?: string; text: string; code?: string; params?: Record<string, string | number> }[];
  chosen?: { optionId: string; labels: OptionLabel[]; by: string; at: string; /** The kitchen's own identified person chose it (their passkey-backed session, their voice on their phone): their confirmation of a stand-in. */ verified?: boolean };
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
export const OpenIntakeInput = z.object({
  need: z.unknown(),
  by: by.optional(),
  /** The site within the kitchen the request is for (a daycare unit, a second restaurant): its amounts are compared with its own orders. */
  site: z.string().min(1).max(80).optional(),
});
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
  openRequest: (session: AgentSession, input: { text: string; neededBy?: string; deliverOn?: string; productIds?: string[]; category?: string }, internal?: { askedWords?: string[] }) => Promise<PurchaseRequest>;
  requestQuote: (session: AgentSession, input: { requestId: string; lines: QuoteRequestLine[] }) => Promise<{ quote: Quote; quoteToken: string; policyPreview: Decision }>;
  /**
   * The gate's own preview of an option, before anyone taps it: the same rules on the card's lines at the prices the
   * live lookup gave (no quote is issued, nothing is signed or logged as a quote). Undefined when it cannot be built.
   */
  previewDecision?: (session: AgentSession, requestId: string, lines: QuoteRequestLine[], offers: LiveOffer[]) => Promise<Decision | undefined>;
  /** The order flow's way to move a request's need-by date (validated and written to the ledger, see orders.ts). */
  changeNeededBy?: (session: AgentSession, requestId: string, input: { neededBy: string | null; by?: string; reason?: string }) => Promise<unknown>;
  spentThisWeek: (orgId: string) => Promise<number>;
  /** What can stand in for the product the request is about, ranked by kitchen use (the product map; see alternatives.ts). */
  alternatives?: AlternativesSource;
  /**
   * One line per remembered item the intake used, for the request (the server wires the kitchen memory's usage lines,
   * which also mark each item's last use). Called after each step, outside the kitchen's lock.
   */
  memoryUsage?: (orgId: string, intake: Pick<Intake, "rules" | "fromMemory" | "concerns">) => Promise<{ itemId?: string; text: string; code?: string; params?: Record<string, string | number> }[]>;
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

/** The family of a request whose words match nothing in the catalogue (refused at once, see open()). */
export const UNMATCHED_FAMILY = "unmatched";

/** Who settled the goal. Only a goal the buyer gave (now or as a stated rule) lets the agent choose a card alone. */
const DECIDING_SOURCES = new Set(["request", "answer", "stated"]);

export type IntakeView = ReturnType<typeof view>;

export function createIntakeFlow(deps: IntakeDeps) {
  const { catalog, repo, kitchens, intakes, ledger, now } = deps;
  const agentActor = (s: AgentSession) => `agent:${s.agentId}`;
  const buyerActor = (who: string) => `buyer:${who}`;
  /** Who acted, for the ledger: the identified person, Dock's answer page, or the agent relaying. */
  const actorOf = (session: AgentSession, via: HumanVia, who: string) => (isVerified(via) ? buyerActor(who) : via.channel === "answer_link" ? "door:answer_link" : agentActor(session));

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

  async function resolveFamily(need: StructuredNeed, profile: KitchenProfile, allowedCategories: string[] = []): Promise<string> {
    if (need.item.category) return need.item.category;
    if (need.item.productId) {
      const [p] = await catalog.searchProducts({ ids: [need.item.productId], limit: 1 });
      if (p) return p.category;
    }
    const hits = await catalog.searchProducts({ text: need.item.text, limit: 100 });
    const counts = new Map<string, number>();
    for (const p of hits) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    // The words' own family first ("laktoositonta maitoa" is milk, though more coffee drinks than milks carry those
    // words), then a product group the kitchen's mandate allows, then the most matches.
    const named = new Set(groupsIn(need.item.text).map((g) => g.replace(/ /g, "_")));
    const allowed = new Set(allowedCategories);
    const most = Math.max(0, ...counts.values());
    // A group the mandate allows counts only when it holds a good share of the matches: a stray hit never turns "beef" into milk.
    const score = (c: string, n: number) => n + (named.has(c) ? 10_000 : 0) + (allowed.has(c) && n * 2 >= most ? 1_000 : 0);
    const top = [...counts.entries()].sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]) || a[0].localeCompare(b[0]))[0];
    if (top) return top[0];
    // No product name carries these words (a Finnish word on an English-named shelf): the family the words name.
    for (const g of named) if ((await catalog.searchProducts({ category: g, limit: 1 })).length) return g;
    if (need.sameAsLastTime && profile.history.length) return profile.history.at(-1)!.family;
    throw new DockError(422, "family_unknown", `No product family matches "${need.item.text}". Send item.category (for example "milk").`);
  }

  /** This kitchen's orders still waiting for sign-off (their price not expired), for the duplicate check. */
  async function pendingOrders(i: Intake): Promise<PendingOrderSummary[]> {
    const t = now().getTime();
    const waiting = (await repo.pendingOrders(i.orgId)).filter((o) => o.requestId !== i.requestId && o.status === "pending_approval" && Date.parse(o.quote.expiresAt) > t);
    const out: PendingOrderSummary[] = [];
    for (const o of waiting) {
      if (!o.lines.length) continue;
      const main = [...o.lines].sort((a, b) => b.quantity * b.packSize - a.quantity * a.packSize)[0];
      const amount = Math.round(o.lines.filter((l) => l.unit === main.unit).reduce((s, l) => s + l.quantity * l.packSize, 0) * 100) / 100;
      const neededBy = (await repo.getRequest(o.requestId))?.neededBy;
      out.push({ orderId: o.orderId, placedAt: o.createdAt, family: main.category, amount, unit: main.unit, ...(neededBy ? { neededBy } : {}), deliveryDate: o.lines.map((l) => l.deliveryDate).sort().at(-1)! });
    }
    return out;
  }

  /** Move the request's need-by date with the intake's need (a correction, or a later delivery the buyer accepted). */
  async function moveNeededBy(session: AgentSession, requestId: string, neededBy: string | undefined, by: string, reason: string, deliverOn?: string) {
    if (deps.changeNeededBy) return void (await deps.changeNeededBy(session, requestId, { neededBy: neededBy ?? null, by, reason, ...(deliverOn ? { deliverOn } : {}) }));
    const req = await repo.getRequest(requestId);
    if (req) await repo.saveRequest({ ...req, neededBy, ...(deliverOn ? { deliverOn } : {}) });
  }

  /** The product map's answer for a product, in the kitchen's constraints; undefined when there is no map or it does not know the product. */
  async function alternativesOf(session: AgentSession, i: Intake, productId: string, requiredClaims: string[], forbiddenAllergens: string[]): Promise<AlternativesAnswer | undefined> {
    if (!deps.alternatives) return undefined;
    try {
      return await deps.alternatives(productId, { text: [i.need.text, i.need.item.text].filter(Boolean).join(" "), requiredClaims, forbiddenAllergens });
    } catch {
      return undefined; // the map is an aid: without it the category-and-claims rule still holds
    }
  }

  function log(i: Intake, actor: string, summary: string, data: Record<string, unknown> = {}) {
    ledger.append({ type: "intake", actor, requestId: i.requestId, summary, data });
  }

  /** Run the checks and move the intake to its next state; then say, one line each, what memory it used. */
  async function advance(session: AgentSession, i: Intake): Promise<Intake> {
    const next = await advanceSteps(session, i);
    const before = JSON.stringify(next.memoryUsed ?? []);
    const lines: { itemId?: string; text: string }[] = [];
    if (deps.memoryUsage) {
      try {
        lines.push(...(await deps.memoryUsage(next.orgId, next)));
      } catch {
        // the lines are an account of what was used; the rules were applied either way
      }
    }
    for (const e of next.excluded) if (e.reason.startsWith("the kitchen does not want it: ")) lines.push({ text: `Left out ${e.productId}: ${e.reason.slice("the kitchen does not want it: ".length)}` });
    for (const o of next.options) for (const c of o.cons) if (/^The kitchen turned .* down before/.test(c) && !lines.some((l) => l.text === c)) lines.push({ text: c });
    next.memoryUsed = lines;
    if (JSON.stringify(lines) !== before) {
      if (lines.length) log(next, "dock", `Dock applied ${lines.length} remembered item${lines.length > 1 ? "s" : ""} of the kitchen's memory to this request, without asking.`, { step: "memory_used", count: lines.length, itemIds: lines.flatMap((l) => (l.itemId ? [l.itemId] : [])) });
      await intakes.save(next);
    }
    return next;
  }

  async function advanceSteps(session: AgentSession, i: Intake): Promise<Intake> {
    const at = now();
    const profile = await profileOf(session);
    const products = await familyProducts(i.family, i.need);
    const ctx: CheckContext = { now: at, profile, family: i.family, candidates: products, suspendedPreferenceIds: i.suspendedPreferenceIds, pending: await pendingOrders(i), ...(i.site ? { site: i.site } : {}) };
    Object.assign(i, { concerns: [], questions: [], openChoices: [], fromMemory: [], notAsked: [], rules: [], options: [], notes: [], excluded: [], preselected: undefined, signOffNotes: undefined, noticed: undefined, refusedOptions: undefined, updatedAt: at.toISOString() });
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
    // Not a likely slip: said, not asked. The buyer sees it on the card; a person signing the order off sees it too.
    i.noticed = noticeNeed(i.need, ctx);
    if (i.noticed.length) {
      (i.signOffNotes ??= []).push(...i.noticed.map((n) => `Noticed, not asked: ${n.message}`));
      log(i, "dock", `AimoPilot noticed, without asking: ${i.noticed.map((n) => n.message).join(" ")}`, { step: "noticed", noticed: i.noticed.map((n) => ({ code: n.code, params: n.params })) });
    }
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
    // What the kitchen turned down before (memory): a rule, or a substitute declined for this very product, is left
    // out with the reason; anything else it declined ranks last and says why. A product the buyer named is theirs
    // to ask for (the mistake check asks about it), so it is never removed here.
    const declinedAll = declinedProducts(profile, i.family, { now: at, referenceId: reference?.productId });
    const declined = new Map<string, string>();
    for (const [id, d] of declinedAll) {
      if (id === i.need.item.productId) continue;
      if (d.leaveOut) {
        const idx = allowed.findIndex((p) => p.id === id);
        if (idx >= 0) {
          allowed.splice(idx, 1);
          i.excluded.push({ productId: id, reason: `the kitchen does not want it: ${d.reason}` });
        }
      } else declined.set(id, d.reason);
    }

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
        log(i, "dock", `AimoPilot asked ${c.questions.length} question${c.questions.length > 1 ? "s" : ""}: ${c.questions.map((q) => q.text).join(" / ")}`, {
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

    // 4. The product map's alternatives for the product the request is about (named, or last time's): priced next to it,
    //    so the cards can offer good, better, best if it cannot be delivered. The map proposes; the hard rules decide.
    const alternatives = reference && reference.source !== "usual" ? await alternativesOf(session, i, reference.productId, constraints.requiredAttributes, constraints.forbiddenAllergens) : undefined;
    if (alternatives) {
      const have = new Set(narrowed.map((p) => p.id));
      const missing = proposedIds(alternatives, 4).filter((id) => !have.has(id));
      if (missing.length) {
        for (const p of await catalog.searchProducts({ ids: missing, limit: missing.length })) {
          const why = declinedAll.get(p.id)?.leaveOut ? `the kitchen does not want it: ${declinedAll.get(p.id)!.reason}` : session.mandate.allowedCategories.includes(p.category) ? violation(p, constraints) : "outside the product groups the mandate allows";
          if (why) i.excluded.push({ productId: p.id, reason: `proposed by the product map, but ${why}` });
          else narrowed.push(p);
        }
      }
    }
    // 5. Live prices for a short list only (one call), then the option cards.
    const prefer = [reference?.productId, ...proposedIds(alternatives, 3), last && primaryLine(last).productId, usual?.kind === "product" ? usual.productId : undefined];
    const short = shortlist(narrowed, prefer, MAX_LIVE_IDS_PER_CALL, i.amount, span);
    // "On Monday": what is available earlier is delivered that day (orders.ts scheduledOn).
    const offersSeen: LiveOffer[] = [];
    const on = (raw: LiveLookupResult): LiveLookupResult => {
      const l = i.need.deliverOn ? { ...raw, offers: raw.offers.map((o) => scheduledOn(o, i.need.deliverOn)), statuses: raw.statuses.map((st) => (st.offer ? { ...st, offer: scheduledOn(st.offer, i.need.deliverOn) } : st)) } : raw;
      offersSeen.push(...l.offers, ...l.statuses.map((st) => st.offer).filter((o): o is LiveOffer => !!o));
      return l;
    };
    const live = on(await deps.liveLookup(session, i.requestId, short.map((p) => p.id), i.need.deliverBy, "AimoPilot checked live price and availability for the shortlist"));
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
      alternatives,
      declined,
      goal: goalForRank,
      span,
      estimates: i.acknowledgements.filter((a) => a.code === "pack_uncertain" && a.action === "confirmed").map((a) => a.key.split(":")[1]),
    });
    let seen: Pick<LiveLookupResult, "offers" | "statuses"> = live;
    let result = options(short, live);
    // One second chance, never more: when the short list leaves gaps (cut-offs passed, stock short, a kind the buyer
    // left open with no card), price the next few products once rather than offer less than the catalogue has.
    const covered = new Set(result.cards.map((c) => span?.(short.find((p) => p.id === c.lines[0].productId)!)));
    const uncovered = span ? new Set(narrowed.map(span).filter((k) => k && !k.includes("?") && !covered.has(k))) : new Set<string>();
    const rest = narrowed.filter((p) => !short.includes(p));
    if (rest.length && (result.cards.length < MAX_CARDS || uncovered.size)) {
      const wanted = rest.filter((p) => uncovered.has(span?.(p) ?? ""));
      const pool = shortlist(wanted.length ? wanted : rest, [], MAX_LIVE_IDS_PER_CALL, i.amount, span);
      const second = on(await deps.liveLookup(session, i.requestId, pool.map((p) => p.id), i.need.deliverBy, "The first short list left gaps; AimoPilot checked the next few products once"));
      short.push(...pool);
      seen = { offers: [...live.offers, ...second.offers], statuses: [...live.statuses, ...second.statuses] };
      result = options(short, seen);
    }
    // The order cut-off for the day asked has passed for everything: ask once for a later day (two days on, or the
    // latest the mandate allows), so the buyer is offered the earliest day that works rather than nothing.
    const cutOff = [...new Set(result.excluded.filter((e) => e.code === "cutoff_passed").map((e) => e.productId))].slice(0, MAX_LIVE_IDS_PER_CALL);
    if (!result.cards.length && cutOff.length && i.need.deliverBy && !i.need.deliverOn) {
      const limit = latestDeliveryDay(at, session.mandate.delivery.maxLeadDays);
      const day = [addDaysIso(i.need.deliverBy, 2), limit].sort()[0];
      if (day > i.need.deliverBy) {
        const later = on(await deps.liveLookup(session, i.requestId, cutOff, day, `The order cut-off for ${i.need.deliverBy} has passed; Dock asked once about ${day} instead`));
        const keep = <T extends { productId: string }>(xs: T[]) => xs.filter((x) => !cutOff.includes(x.productId));
        result = options(short, { offers: [...keep(seen.offers), ...later.offers], statuses: [...keep(seen.statuses), ...later.statuses] });
        if (result.cards.length) result.notes.unshift(`The order cut-off for ${formatDay(i.need.deliverBy)} has passed, so these come later: the earliest day Dock found is on each option.`);
      }
    }
    i.notes.push(...result.notes, ...i.notAsked);
    i.excluded.push(...result.excluded);
    if (result.cards.length === 0) return noOptions(i, noOptionReason(result.excluded, i.need.deliverBy, { mandate: session.mandate, ...budget }, Object.fromEntries(products.map((p) => [p.id, p.name]))));
    i.options = result.cards;
    // A confirmation that matters came only as the agent's word: every card says a named person will sign it.
    if (i.unverified?.length) for (const card of i.options) card.signOff.push(`The agent relayed a confirmation nobody verified (${i.unverified.map((u) => u.code).join(", ")}): a person must sign this order off.`);
    // Every card through the gate's own preview: what will happen when it is tapped. A card the gate would refuse is
    // never offered as a choice; it stays, last and marked, only to say why the obvious choice is missing.
    if (deps.previewDecision) {
      await intakes.save(i); // the preview reads what the intake knows (an unverified confirmation)
      for (const card of i.options) {
        const d = await deps.previewDecision(session, i.requestId, quoteLinesOf(card), offersSeen).catch(() => undefined);
        if (!d) continue;
        const deciding = d.rules.find((r) => r.outcome === "fail") ?? d.rules.find((r) => r.outcome === "escalate");
        card.gate = {
          outcome: d.outcome,
          ...(deciding ? { rule: deciding.rule } : {}),
          ...(d.outcome === "needs_human_approval" ? { approver: { name: d.approver.name, role: d.approver.role } } : {}),
          reasons: d.reasons,
          escalated: d.rules.filter((r) => r.outcome === "escalate").map((r) => r.rule),
        };
      }
      const refused = i.options.filter((o) => o.gate?.outcome === "reject");
      if (refused.length) {
        // Not offered: kept apart, so a screen can say why the obvious choice is missing.
        i.options = i.options.filter((o) => o.gate?.outcome !== "reject");
        i.refusedOptions = refused;
        log(i, "dock", `The gate's preview refuses ${refused.map((o) => `${o.optionId} (${o.gate!.rule})`).join(", ")}: not offered as a choice.`, { step: "preview", refused: refused.map((o) => ({ optionId: o.optionId, rule: o.gate!.rule, reasons: o.gate!.reasons })) });
        if (i.options.length === 0) return noOptions(i, refused[0].gate!.reasons.join(" "));
      }
    }

    // 5. Plausibility warnings: if every option goes to a person for sign-off anyway, that person sees the warning
    //    with the order; the buyer is not asked twice. Otherwise ask now, before anything is chosen.
    // A first order has nothing to compare with: its size is shown on every card and to whoever signs it off,
    // never a blocking step (a hotel ordering 1,000 L is ordinary, and the buyer said it in words).
    for (const c of deferred.filter((x) => x.code === "large_first_order")) {
      for (const card of i.options) card.cons.push(c.message);
      (i.signOffNotes ??= []).push(`Check the amount: ${c.message}`);
      log(i, "dock", `AimoPilot did not stop the buyer for large_first_order: it is a note on every option${i.options.some((o) => o.totalCents > session.mandate.perOrderLimitCents) ? " and goes to the person signing off" : ""}.`, { step: "noted", concerns: [{ key: c.key, code: c.code }], reasons: [c.message] });
    }
    const ask = deferred.filter((x) => x.code !== "large_first_order");
    if (ask.length) {
      const limit = session.mandate.perOrderLimitCents;
      if (result.cards.every((c) => c.totalCents > limit)) {
        (i.signOffNotes ??= []).push(...ask.map((c) => `Check the amount: ${c.message} (not asked before ordering, because a person signs this order off anyway).`));
        log(i, "dock", `AimoPilot did not stop the buyer for ${ask.map((c) => c.code).join(", ")}: every option is over the ${formatEur(limit)} the agent may spend alone, so the person signing it off sees it.`, {
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
    // The agent never picks, nor pre-selects, a product the kitchen turned down before: that is the buyer's call.
    const candidatePick = goalForRank ? preselect(i.options, goalForRank, goal.within) : undefined;
    const pickedCard = candidatePick && i.options.find((o) => o.optionId === candidatePick.optionId);
    const pick = pickedCard && (pickedCard.lines.some((l) => declined.has(l.productId)) || pickedCard.gate?.outcome === "reject") ? undefined : candidatePick;
    if (pick && goal.source) i.preselected = { ...pick, source: goal.source as NonNullable<Intake["preselected"]>["source"] };
    const picked = i.preselected && i.options.find((o) => o.optionId === i.preselected!.optionId);
    log(i, "dock", `AimoPilot offered ${i.options.length} option${i.options.length > 1 ? "s" : ""} for ${formatAmount(i.amount.amount, i.amount.unit)} of ${i.family} (${i.options.every((o) => o.match === "full") ? "all full matches, ranked" : "none meets the whole request; each says what it gives up"})${i.preselected ? `; pre-selected ${i.preselected.optionId} (${i.preselected.reason})` : ""}.`, {
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
    log(i, "dock", `AimoPilot found ${concerns.length} thing${concerns.length > 1 ? "s" : ""} to check ${when}.`, {
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
    log(i, "dock", `AimoPilot found no option: ${reason}`, { step: "no_options", reasons: i.excluded.map((e) => `${e.productId}: ${e.reason}`) });
    await intakes.save(i);
    return i;
  }

  /** No option without looking anything up: the request names no product Dock can find, or a group the mandate does not allow. */
  async function refuseUpFront(i: Intake, rule: "family_unknown" | "category_allowed", reason: string): Promise<Intake> {
    i.state = "no_options";
    i.notes = [reason];
    log(i, "dock", `Dock found no option: ${reason}`, { step: "no_options", rule, reasons: [reason] });
    await intakes.save(i);
    return i;
  }

  async function quoteOption(session: AgentSession, i: Intake, card: OptionCard, who: string, reason?: string, via: HumanVia = RELAYED): Promise<Intake> {
    const at = now().toISOString();
    // Whoever signs off a substitute sees why it stands in: the product map's tier and reason.
    if (card.alternative) (i.signOffNotes ??= []).push(`Substitute for ${card.alternative.for}, ranked ${card.alternative.tier} by the product map${card.alternative.use ? ` for ${card.alternative.use}` : ""}: ${card.alternative.reason}`);
    const byAgent = who.startsWith("agent ");
    const verified = isVerified(via);
    log(i, byAgent ? agentActor(session) : actorOf(session, via, who), `${who} chose ${card.optionId}${byAgent ? "" : ` (${howText(via)})`} (${card.labels.map((l) => LABEL_TEXT[l]).join(", ")}): ${cardLine(card)}${reason ? ` ${reason}` : ""}`, {
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
    // An alternative the product map proposed for the product the request is about is declared as its substitute,
    // so the gate prices it against that product (substitute_price) and applies the mandate's substitution rule.
    const lines = quoteLinesOf(card);
    i.chosen = { optionId: card.optionId, labels: card.labels, by: who, at, ...(!byAgent && verified ? { verified: true } : {}) };
    await intakes.save(i); // the gate's preview reads who chose it
    const quoted = await deps.requestQuote(session, { requestId: i.requestId, lines });
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
      // Nothing in the catalogue answers to the words: the request is still opened and refused in words a chef
      // understands, so it shows on the wall, in the ledger and in the operations trace (never a bare 422).
      let unmatched = false;
      const family = await resolveFamily(need, profile, session.mandate.allowedCategories).catch((err) => {
        if (!(err instanceof DockError) || err.code !== "family_unknown") throw err;
        unmatched = true;
        return UNMATCHED_FAMILY;
      });
      if (!unmatched && need.sameAsLastTime && !need.quantity && !lastOrder(profile, family)) {
        throw new DockError(422, "nothing_to_repeat", `There is no earlier ${family} order to repeat. Send a quantity to see the options.`);
      }
      // What was asked for, for the gate: the product the buyer named, and the family. Anything else ordered under
      // this request is a substitute of it, whatever the agent declares (policy substitution_rule).
      // And the words that say which kind of product within the family ("oat" drink): the gate holds a line of the
      // family that does not carry them as a stand-in, judged by the substitution rule (core/qualifiers.ts).
      // Not for a repeat or a named product: the product itself is the reference there (the substitution rule names it).
      const kind = unmatched || need.item.productId || need.sameAsLastTime ? undefined : await qualifiersOf(catalog, family, need.item.text).catch(() => undefined);
      const askedWords = kind?.words.map((w) => w.word) ?? [];
      const request = await deps.openRequest(session, { text: need.text ?? describeNeed(need), neededBy: need.deliverBy, ...(need.deliverOn ? { deliverOn: need.deliverOn } : {}), ...(need.item.productId ? { productIds: [need.item.productId] } : {}), ...(unmatched ? {} : { category: family }) }, askedWords.length ? { askedWords } : {});
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
        ...(body.site ? { site: body.site } : {}),
      };
      log(i, agentActor(session), `Structured need (${unmatched ? "no product family found" : family}): ${describeNeed(need)}.`, { step: "need", need, by: body.by, ...(session.door ? { door: session.door } : {}), ...(changes.length ? { reasons: changes.map((c) => `In the catalogue's words: ${c}`) } : {}) });
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
      const also = alsoAskedIn(need.text, need);
      if (also.length) {
        i.alsoAsked = also;
        log(i, "dock", `The buyer's words name more than this request covers: ${also.map((x) => `"${x.text}"`).join(", ")}. Dock says so on the step and orders nothing for ${also.length === 1 ? "it" : "them"} here.`, { step: "also_asked", alsoAsked: also, reasons: [alsoAskedNote(also)!] });
      }
      const what = need.item.text.trim() || "this";
      if (unmatched) {
        return view(await refuseUpFront(i, "family_unknown", `Dock found nothing called "${what}" in the wholesaler's catalogue (it searched product names in English, Finnish and Swedish). Try another word for it, or name the product.`));
      }
      const allowed = session.mandate.allowedCategories;
      if (!allowed.includes(family)) {
        const groups = allowed.map((c) => c.replaceAll("_", " "));
        return view(
          await refuseUpFront(
            i,
            "category_allowed",
            `The kitchen's agent may not buy ${what}: its signed mandate covers ${groups.length > 1 ? `${groups.slice(0, -1).join(", ")} and ${groups.at(-1)}` : groups[0]} only, and ${what} is in another product group${family.startsWith("cat_") ? "" : ` (${family.replaceAll("_", " ")})`}. Whoever signs the kitchen's mandate can add that group; until then nothing is priced or ordered.`,
          ),
        );
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
      const actor = actorOf(session, via, who);
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
            : via.channel === "answer_link"
              ? `Confirmed as intended ${how}, answered as ${who} (the person is not identified: whoever holds the link can answer): ${c.message}${matters ? " Nobody verified who answered, so the order cannot be decided by the agent alone: a named person signs it off, with this shown." : ""}`
              : via.channel === "protocol_elicitation"
                ? `Relayed by the agent's client, not verified: its form (MCP elicitation) came back answered as ${who}, confirming this as intended: ${c.message}${matters ? " AimoPilot cannot tell whether a person filled the form in, so the order cannot be decided by the agent alone: a named person signs it off, with this shown." : ""}`
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
      if (i.need.deliverBy !== neededBefore) await moveNeededBy(session, requestId, i.need.deliverBy, who, "corrected in the mistake check", i.need.deliverOn);
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
      const toRemember: StatedPreference[] = [];
      const notRemembered: string[] = [];
      for (const a of answers) {
        const q = askable.find((x) => x.id === a.questionId);
        if (!q) throw new DockError(409, "question_not_open", `Question ${a.questionId} is not open.`, undefined, { open: askable.map((x) => x.id) });
        if (!q.options.some((o) => o.id === a.optionId)) throw new DockError(400, "option_unknown", `${a.optionId} is not an option of ${q.id}: ${q.options.map((o) => o.id).join(", ")}.`);
        i.answers.push({ ...a, by: who, at });
        let remembered = "";
        if (a.remember && verified) {
          const pref = rememberAnswer(q, a.optionId, i, who, at);
          toRemember.push(pref);
          remembered = ` Remembered for next time as "${pref.text}".`;
        } else if (a.remember) {
          // A rule of the kitchen is a person's word. An answer only relayed by an agent applies to this request.
          remembered = " Not stored as a kitchen rule: an answer relayed by the agent cannot set one; the kitchen can state it on its memory page.";
          notRemembered.push(`"${optionLabel(q, a.optionId)}" applies to this request only: an answer relayed by the agent is not stored as a kitchen rule.`);
        }
        log(i, actorOf(session, via, who), `${who} answered "${q.text}" (${how}): ${optionLabel(q, a.optionId)}.${remembered}`, { step: "answer", questionId: q.id, optionId: a.optionId, remember: !!a.remember && verified, by: who, relayedBy: session.agentId, channel: via.channel, verified, ...(via.words ? { words: via.words } : {}) });
      }
      // Under the kitchen's lock, on the latest profile: a memory write in between is not lost.
      if (toRemember.length) {
        await updateKitchenProfile(kitchens, session.mandate.issuer.orgId, (p) => toRemember.reduce((acc, pref) => addStatedPreference(acc, pref), p ?? emptyProfile(session.mandate.issuer.orgId, session.mandate.issuer.name)));
      }
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
      if (card.gate?.outcome === "reject") throw new DockError(422, "option_refused", `The gate would refuse ${optionId}: ${card.gate.reasons.join(" ")}`, card.gate.rule, { optionId });
      if (card.givesUp.some((g) => g.part === "amount")) {
        // Taking the part that fits now is the buyer changing the amount of this request; the rest is said, not lost.
        const before = describeNeed(i.need);
        i.need = applyNeedPatch(i.need, { quantity: { amount: card.delivered.amount, unit: card.delivered.unit } });
        const rest = card.givesUp.find((g) => g.part === "amount")!;
        log(i, actorOf(session, via, who), `${who} took the part that fits now (${howText(via)}): ${describeNeed(i.need)} instead of ${before}. ${rest.text}`, { step: "compromise", optionId, givesUp: card.givesUp, by: who, relayedBy: session.agentId, channel: via.channel, verified });
        i.notes.push(rest.text);
      }
      if (card.givesUp.some((g) => g.part === "delivery_date")) {
        // Choosing a later day is the buyer moving their own deadline: the request and the gate follow it.
        const before = i.need.deliverBy;
        i.need = applyNeedPatch(i.need, { deliverBy: card.deliveryDate });
        await moveNeededBy(session, requestId, card.deliveryDate, who, `accepted a later delivery (${optionId})`, i.need.deliverOn ? card.deliveryDate : undefined);
        log(i, actorOf(session, via, who), `${who} accepted a later delivery (${howText(via)}): ${card.deliveryDate} instead of ${before}.`, { step: "compromise", optionId, givesUp: card.givesUp, by: who, relayedBy: session.agentId, channel: via.channel, verified });
      }
      return view(await quoteOption(session, i, card, who, undefined, via));
    },

    async kitchen(session: AgentSession) {
      return kitchenView(await profileOf(session));
    },
  };
}

/**
 * The lines a card is quoted with. An alternative the product map proposed for the product the request is about is
 * declared as its substitute, so the gate prices it against that product (substitute_price) and applies the
 * mandate's substitution rule.
 */
function quoteLinesOf(card: OptionCard): QuoteRequestLine[] {
  const alt = card.alternative?.for;
  return alt ? card.quoteLines.map((l, n) => (n === 0 && !l.substituteFor && l.productId !== alt ? { ...l, substituteFor: alt } : l)) : card.quoteLines;
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
  /** Product names by id, so the reason names each product a person would not know by its code. */
  names: Record<string, string> = {},
): string {
  const label = (id: string) => (names[id] ? `${names[id]} (${id})` : id);
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
  if (cutoff.length) parts.push(`the order cut-off has passed for ${cutoff.map((e) => label(e.productId)).join(", ")}, so ${cutoff.length > 1 ? "they" : "it"} cannot arrive by ${deliverBy ?? "the date asked"}`);
  for (const [, list] of others) parts.push([...new Set(list.map((e) => `${label(e.productId)}: ${e.reason}`))].slice(0, 2).join("; "));
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
  const intake = await deps.intakes.get(order.requestId);
  const lines = order.lines.map((l) => ({ productId: l.productId, name: l.name, category: l.category, attributes: l.attributes, packs: l.quantity, packSize: l.packSize, unit: l.unit, unitPriceCents: l.unitPriceCents }));
  const main = [...lines].sort((a, b) => b.packs * b.packSize - a.packs * a.packSize)[0];
  const entry: HistoryEntry = {
    orderId: order.orderId,
    ...(intake?.site ? { site: intake.site } : {}),
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
  await updateKitchenProfile(deps.kitchens, order.orgId, (p) => recordOrder(p ?? emptyProfile(order.orgId, order.orgName), entry));
}

/** The step's notes, ending with what else the buyer asked for, so nothing they named vanishes without a word. */
function withAlsoAsked(i: Intake): string[] {
  const note = alsoAskedNote(i.alsoAsked ?? []);
  return note && !i.notes.includes(note) ? [...i.notes, note] : i.notes;
}

/**
 * What leaves Dock for an intake: the state, what to show, and the next call to make. The example body of a step
 * that waits for the buyer never holds an answer: only placeholders a person's own choice replaces (an agent that
 * copied a pre-filled correction would turn 1,000 L into 100 L without anyone deciding it).
 */
export function view(i: Intake) {
  const base = `/api/v1/intake/${i.requestId}`;
  const BY = "<the buyer's name>";
  const next =
    i.state === "needs_confirmation"
      ? { method: "POST", path: `${base}/concerns`, example: { by: BY, responses: i.concerns.map((c) => ({ key: c.key, choice: `<the buyer's choice: ${[...(c.confirmable ? ["confirm"] : []), ...c.corrections.map((x) => x.id)].join(" or ")}>` })) } }
      : i.state === "needs_input"
        ? { method: "POST", path: `${base}/answers`, example: { by: BY, answers: i.questions.map((q) => ({ questionId: q.id, optionId: `<the buyer's choice: ${q.options.map((o) => o.id).join(" or ")}>`, remember: false })) } }
        : i.state === "options_ready"
          ? { method: "POST", path: `${base}/choice`, example: { by: BY, optionId: `<the option the buyer picks: ${i.options.map((o) => o.optionId).join(" or ")}${i.preselected ? `; ${i.preselected.optionId} only if they asked the agent to decide` : ""}>` } }
          : i.state === "quoted"
            ? // The requestId alone places the quote Dock signed for this request (no long token to copy).
              { method: "POST", path: "/api/v1/orders", example: { requestId: i.requestId } }
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
    notes: withAlsoAsked(i),
    excluded: i.excluded,
    alsoAsked: i.alsoAsked ?? [],
    memoryUsed: i.memoryUsed ?? [],
    signOffNotes: i.signOffNotes ?? [],
    noticed: i.noticed ?? [],
    refusedOptions: i.refusedOptions ?? [],
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
