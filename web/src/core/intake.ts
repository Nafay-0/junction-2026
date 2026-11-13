import { z } from "zod";
import { MAX_LIVE_IDS_PER_CALL, type MeteredCatalog, type Product } from "./catalog";
import { answerSchema, clarify, hardConstraints, optionLabel, violation, type Answer, type ConstraintSource, type MemoryNote, type Question } from "./clarify";
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
} from "./kitchen";
import type { Ledger } from "./ledger";
import { NeedSchema, SPEC_DIMENSIONS, applyNeedPatch, describeNeed, formatAmount, type BaseUnit, type StructuredNeed } from "./need";
import { LABEL_TEXT, buildOptions, preselect, shortlist, type OptionCard, type OptionLabel } from "./options";
import type { AgentSession, DockRepository, Order, PurchaseRequest } from "./orders";
import type { Decision } from "./policy";
import type { Quote, QuoteRequestLine } from "./quote";
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

export type Acknowledgement = { key: string; code: ConcernCode; action: "confirmed" | "corrected" | "cancelled"; correctionId?: string; by: string; at: string };

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
  fromMemory: MemoryNote[];
  notAsked: string[];
  /** The hard rules every option obeys, and where each came from (mandate, request, a person's stated preference). */
  rules: ConstraintSource[];
  options: OptionCard[];
  preselected?: { optionId: string; reason: string; source: "request" | "answer" | "stated" | "learned" };
  notes: string[];
  excluded: { productId: string; reason: string }[];
  chosen?: { optionId: string; labels: OptionLabel[]; by: string; at: string };
  quote?: { quote: Quote; quoteToken: string; policyPreview: Decision };
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
  openRequest: (session: AgentSession, input: { text: string; neededBy?: string }) => Promise<PurchaseRequest>;
  requestQuote: (session: AgentSession, input: { requestId: string; lines: QuoteRequestLine[] }) => Promise<{ quote: Quote; quoteToken: string; policyPreview: Decision }>;
  spentThisWeek: (orgId: string) => Promise<number>;
};

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
    if (!states.includes(i.state)) throw new DockError(409, "intake_wrong_state", `Cannot ${what} now: request ${i.requestId} is ${i.state}.`, undefined, { state: i.state });
  }

  async function familyProducts(family: string): Promise<Product[]> {
    return catalog.searchProducts({ category: family, limit: 100 });
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
    const products = await familyProducts(i.family);
    const ctx: CheckContext = { now: at, profile, family: i.family, candidates: products, suspendedPreferenceIds: i.suspendedPreferenceIds };
    Object.assign(i, { concerns: [], questions: [], fromMemory: [], notAsked: [], rules: [], options: [], notes: [], excluded: [], preselected: undefined, updatedAt: at.toISOString() });

    // 1. Likely mistakes block everything else.
    const acked = new Set(i.acknowledgements.map((a) => a.key));
    const concerns = checkNeed(i.need, ctx).filter((c) => !acked.has(c.key));
    if (concerns.length) {
      i.state = "needs_confirmation";
      i.concerns = concerns;
      log(i, "dock", `Dock found ${concerns.length} thing${concerns.length > 1 ? "s" : ""} to check before any price lookup.`, {
        step: "concerns",
        reasons: concerns.map((c) => `${c.code}: ${c.message}`),
        concerns: concerns.map((c) => ({ key: c.key, code: c.code, severity: c.severity })),
      });
      await intakes.save(i);
      return i;
    }
    i.amount = baseAmount(i.need, ctx) ?? (i.need.sameAsLastTime ? lastAmount(profile, i.family) : undefined);
    if (!i.amount) throw new DockError(422, "amount_unknown", "Could not work out the amount in litres, kilos or pieces.");

    // 2. Hard constraints: mandate, request, stated preferences.
    const stated = statedFor(profile, i.family);
    const constraints = hardConstraints(session.mandate, i.need, stated, i.suspendedPreferenceIds);
    i.rules = constraints.sources;
    let allowed = products.filter((p) => {
      const why = violation(p, constraints);
      if (why) i.excluded.push({ productId: p.id, reason: why });
      return !why;
    });
    if (i.need.item.productId) allowed = allowed.filter((p) => p.id === i.need.item.productId);
    const learned = learnPreferences(profile, i.family);
    const last = lastOrder(profile, i.family);
    const usual = learned.find((l) => l.kind === "product");
    const spent = await deps.spentThisWeek(i.orgId);

    // 3. "Same as last time": straight to a quote when the last product can still fill it.
    if (i.need.sameAsLastTime && last) {
      const lastProduct = allowed.find((p) => p.id === primaryLine(last).productId);
      if (lastProduct) {
        const offers = await liveOffers(session, i, [lastProduct]);
        const { cards, excluded } = buildOptions({ amount: i.amount, candidates: [lastProduct], offers, mandate: session.mandate, now: at, neededBy: i.need.deliverBy, spentThisWeekCents: spent, last });
        const card = cards[0] && { ...cards[0], labels: ["same_as_last_time" as const] };
        if (card) {
          i.options = [card];
          i.notes = [`Repeats your order of ${formatAmount(last.amount, last.unit)} from ${last.placedAt.slice(0, 10)}.`];
          return quoteOption(session, i, card, `agent ${session.agentId}`, "Same as last time, as asked.");
        }
        i.notes.push(`Same as last time is not possible: ${excluded[0]?.reason ?? "no offer"}. Here are the options instead.`);
      } else {
        const why = i.excluded.find((e) => e.productId === primaryLine(last).productId)?.reason ?? "not in the catalogue now";
        i.notes.push(`Same as last time (${primaryLine(last).name}) is not possible: ${why}. Here are the options instead.`);
      }
    }

    // 4. Ask only what matters and what memory does not answer.
    const c = clarify({ need: i.need, candidates: allowed, stated, learned, answers: i.answers, suspended: i.suspendedPreferenceIds });
    i.fromMemory = c.fromMemory;
    i.notAsked = c.notAsked;
    const memoryText = [
      ...i.rules.filter((r) => r.source === "stated").map((r) => r.text),
      ...c.fromMemory.map((m) => `${m.question.text} ${m.label} (${m.source === "stated" ? "stated earlier" : "learned, pre-selected"})`),
    ];
    if (c.questions.length) {
      i.state = "needs_input";
      i.questions = c.questions;
      log(i, "dock", `Dock asked ${c.questions.length} question${c.questions.length > 1 ? "s" : ""}: ${c.questions.map((q) => q.text).join(" / ")}`, {
        step: "questions",
        questions: c.questions.map((q) => ({ id: q.id, options: q.options.map((o) => o.id) })),
        reasons: memoryText.map((t) => `From memory: ${t}`),
      });
      await intakes.save(i);
      return i;
    }

    const narrowed = allowed.filter((p) => c.settled.attributes.every((a) => p.attributes.includes(a)) && !c.settled.excludedAttributes.some((a) => p.attributes.includes(a)));
    if (narrowed.length === 0) return noOptions(i, allowed.length ? "No product matches the answers given." : "No product in this family meets the mandate, the request and the kitchen's stated rules.");

    // 5. Live prices for a short list only, then the option cards.
    const offers = await liveOffers(session, i, shortlist(narrowed, [last && primaryLine(last).productId, usual?.kind === "product" ? usual.productId : undefined], MAX_LIVE_IDS_PER_CALL));
    const result = buildOptions({
      amount: i.amount,
      candidates: narrowed,
      offers,
      mandate: session.mandate,
      now: at,
      neededBy: i.need.deliverBy,
      spentThisWeekCents: spent,
      last,
      usual: usual?.kind === "product" ? { productId: usual.productId, text: usual.text } : undefined,
    });
    i.notes.push(...result.notes, ...c.notAsked);
    i.excluded.push(...result.excluded);
    if (result.cards.length === 0) return noOptions(i, "Nothing in stock can be delivered in time within the mandate.");
    i.state = "options_ready";
    i.options = result.cards;
    const goal = c.settled.optimise === "no_preference" ? undefined : c.settled.optimise;
    const pick = preselect(result.cards, goal, c.settled.optimiseWithinPctOfCheapest);
    if (pick && c.settled.optimiseSource) i.preselected = { ...pick, source: c.settled.optimiseSource };
    log(i, "dock", `Dock offered ${result.cards.length} option${result.cards.length > 1 ? "s" : ""} for ${formatAmount(i.amount.amount, i.amount.unit)} of ${i.family}${i.preselected ? `; pre-selected ${i.preselected.optionId} (${i.preselected.reason})` : ""}.`, {
      step: "options",
      reasons: [...result.cards.map(cardLine), ...memoryText.map((t) => `From memory: ${t}`)],
      options: result.cards.map((o) => ({ optionId: o.optionId, labels: o.labels, totalCents: o.totalCents, lines: o.quoteLines })),
      excluded: i.excluded,
    });
    await intakes.save(i);
    return i;
  }

  async function liveOffers(session: AgentSession, i: Intake, products: Product[]) {
    const offers = await catalog.getLiveOffers(products.map((p) => p.id));
    ledger.append({
      type: "lookup",
      actor: agentActor(session),
      requestId: i.requestId,
      summary: `Dock checked live price and availability for ${products.length} shortlisted product(s) (live call #${catalog.stats().liveCalls}).`,
      data: { source: "live", productIds: products.map((p) => p.id), offers },
    });
    return offers;
  }

  async function noOptions(i: Intake, reason: string): Promise<Intake> {
    i.state = "no_options";
    i.notes.unshift(reason);
    log(i, "dock", `Dock found no option: ${reason}`, { step: "no_options", reasons: i.excluded.map((e) => `${e.productId}: ${e.reason}`) });
    await intakes.save(i);
    return i;
  }

  async function quoteOption(session: AgentSession, i: Intake, card: OptionCard, who: string, reason?: string): Promise<Intake> {
    const at = now().toISOString();
    log(i, who.startsWith("agent ") ? agentActor(session) : buyerActor(who), `${who} chose ${card.optionId} (${card.labels.map((l) => LABEL_TEXT[l]).join(", ")}): ${cardLine(card)}${reason ? ` ${reason}` : ""}`, {
      step: "choice",
      optionId: card.optionId,
      labels: card.labels,
      lines: card.quoteLines,
      by: who,
      relayedBy: session.agentId,
    });
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
      const need = parse(NeedSchema, body.need);
      const profile = await profileOf(session);
      const family = await resolveFamily(need, profile);
      if (need.sameAsLastTime && !need.quantity && !lastOrder(profile, family)) {
        throw new DockError(422, "nothing_to_repeat", `There is no earlier ${family} order to repeat. Send a quantity to see the options.`);
      }
      const request = await deps.openRequest(session, { text: need.text ?? describeNeed(need), neededBy: need.deliverBy });
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
      log(i, agentActor(session), `Structured need (${family}): ${describeNeed(need)}.`, { step: "need", need, by: body.by });
      return view(await advance(session, i));
    },

    async get(session: AgentSession, requestId: string): Promise<IntakeView> {
      return view(await own(session, requestId));
    },

    /** Confirm a concern as intended, or take one of its corrections. */
    async respondToConcerns(session: AgentSession, requestId: string, input: z.input<typeof ConcernResponseInput>): Promise<IntakeView> {
      const { by: who, responses } = parse(ConcernResponseInput, input);
      const i = await own(session, requestId);
      expectState(i, ["needs_confirmation"], "respond to concerns");
      const at = now().toISOString();
      const neededBefore = i.need.deliverBy;
      for (const r of responses) {
        const c = i.concerns.find((x) => x.key === r.key);
        if (!c) throw new DockError(409, "concern_not_open", `No open concern ${r.key}.`, undefined, { open: i.concerns.map((x) => x.key) });
        if (r.choice === "confirm") {
          if (!c.confirmable) throw new DockError(409, "concern_not_confirmable", `${c.code} cannot be confirmed as is; choose one of: ${c.corrections.map((x) => x.id).join(", ") || "(none: start a new request)"}.`);
          i.acknowledgements.push({ key: c.key, code: c.code, action: "confirmed", by: who, at });
          i.suspendedPreferenceIds.push(...(c.preferenceIds ?? []));
          log(i, buyerActor(who), `${who} confirmed as intended: ${c.message}`, { step: "confirmation", key: c.key, code: c.code, by: who, relayedBy: session.agentId, suspendedPreferenceIds: c.preferenceIds });
          continue;
        }
        const fix = c.corrections.find((x) => x.id === r.choice);
        if (!fix) throw new DockError(400, "correction_unknown", `Concern ${c.key} has no correction ${r.choice}; use "confirm"${c.confirmable ? "" : " (not allowed here)"} or one of: ${c.corrections.map((x) => x.id).join(", ")}.`);
        if (fix.cancel) {
          i.acknowledgements.push({ key: c.key, code: c.code, action: "cancelled", correctionId: fix.id, by: who, at });
          i.state = "cancelled";
          i.concerns = [];
          i.updatedAt = at;
          log(i, buyerActor(who), `${who} cancelled the request: ${fix.label}.`, { step: "cancelled", key: c.key, code: c.code, by: who, relayedBy: session.agentId });
          await intakes.save(i);
          return view(i);
        }
        const before = describeNeed(i.need);
        i.need = applyNeedPatch(i.need, fix.patch ?? {});
        i.acknowledgements.push({ key: c.key, code: c.code, action: "corrected", correctionId: fix.id, by: who, at });
        log(i, buyerActor(who), `${who} corrected ${c.code}: ${fix.label}.`, { step: "correction", key: c.key, code: c.code, correctionId: fix.id, by: who, relayedBy: session.agentId, before, after: describeNeed(i.need) });
      }
      if (i.need.deliverBy !== neededBefore) {
        const req = await repo.getRequest(requestId);
        if (req) await repo.saveRequest({ ...req, neededBy: i.need.deliverBy });
      }
      return view(await advance(session, i));
    },

    /** Answer questions (or change an answer that memory pre-selected). `remember` stores it as a stated preference. */
    async answer(session: AgentSession, requestId: string, input: z.input<typeof AnswersInput>): Promise<IntakeView> {
      const { by: who, answers } = parse(AnswersInput, input);
      const i = await own(session, requestId);
      expectState(i, ["needs_input", "options_ready"], "answer questions");
      const askable = [...i.questions, ...i.fromMemory.map((m) => m.question)];
      const at = now().toISOString();
      let profile = await profileOf(session);
      for (const a of answers) {
        const q = askable.find((x) => x.id === a.questionId);
        if (!q) throw new DockError(409, "question_not_open", `Question ${a.questionId} is not open.`, undefined, { open: askable.map((x) => x.id) });
        if (!q.options.some((o) => o.id === a.optionId)) throw new DockError(400, "option_unknown", `${a.optionId} is not an option of ${q.id}: ${q.options.map((o) => o.id).join(", ")}.`);
        i.answers.push({ ...a, by: who, at });
        let remembered = "";
        if (a.remember) {
          const pref = rememberAnswer(q, a.optionId, i, who, at);
          profile = addStatedPreference(profile, pref);
          remembered = ` Remembered for next time as "${pref.text}".`;
        }
        log(i, buyerActor(who), `${who} answered "${q.text}": ${optionLabel(q, a.optionId)}.${remembered}`, { step: "answer", questionId: q.id, optionId: a.optionId, remember: !!a.remember, by: who, relayedBy: session.agentId });
      }
      await kitchens.saveProfile(profile);
      return view(await advance(session, i));
    },

    /** Choose an option card: Dock asks the wholesaler for a signed quote and runs the policy preview. */
    async choose(session: AgentSession, requestId: string, input: z.input<typeof ChoiceInput>): Promise<IntakeView> {
      const { by: who, optionId } = parse(ChoiceInput, input);
      const i = await own(session, requestId);
      expectState(i, ["options_ready"], "choose an option");
      const card = i.options.find((o) => o.optionId === optionId);
      if (!card) throw new DockError(404, "option_not_found", `No option ${optionId}; choose one of ${i.options.map((o) => o.optionId).join(", ")}.`);
      return view(await quoteOption(session, i, card, who));
    },

    async kitchen(session: AgentSession) {
      return kitchenView(await profileOf(session));
    },
  };
}

function lastAmount(profile: KitchenProfile, family: string) {
  const l = lastOrder(profile, family);
  return l && { amount: l.amount, unit: l.unit };
}

function cardLine(c: OptionCard): string {
  return `[${c.labels.map((l) => LABEL_TEXT[l]).join(", ")}] ${c.lines.map((l) => `${l.packs} x ${l.productId}`).join(" + ")} for ${formatEur(c.totalCents)}, delivery ${c.deliveryDate}`;
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
    fromMemory: i.fromMemory,
    rules: i.rules,
    options: i.options,
    preselected: i.preselected,
    notes: i.notes,
    excluded: i.excluded,
    acknowledgements: i.acknowledgements,
    chosen: i.chosen,
    quote: i.quote,
    next,
  };
}
