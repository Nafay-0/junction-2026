import { MAX_LIVE_IDS_PER_CALL, usableOffer, type LiveOffer, type LiveStatus, type Product } from "@/core/catalog";
import { formatAmount as formatMeasure } from "@/core/catalog/pack";
import { formatDay } from "@/core/kitchen";
import type { Mandate } from "@/core/mandate";
import { buildOptions, formatCutoff, type OptionCard } from "@/core/options";
import { formatEur } from "@/core/util";
import type { DraftIngredient, DraftUnit, MenuDraft } from "./draft";
import type { Candidate, Rejected } from "./match";
import { safetyProblem, type DietRules, type SafetyCheck } from "./safety";

/**
 * The menu plan, computed by plain code from the model's draft, the catalogue and live offers. Pure: the service
 * (service.ts) does the searching, the live calls and the model calls, and keeps the state; this file only
 * turns that state into the sheet a chef reads, every figure traceable to its working.
 *
 *   amount   per cover x covers / usable share = what to buy; then whole packs, by the core's pack conversion
 *   product  the core's good-better-best options (core/options.ts) over the products that fit the ingredient's
 *            role and pass the kitchen's rules (safety.ts), priced by one batched live lookup
 *   doubts   only what changes the outcome: cannot arrive in time, no safe product, allergen data that cannot
 *            show the rule is met, a different form than the dish needs, an amount the code thinks is wrong.
 *            Everything else goes through without a question.
 */

export type BaseUnit = "kg" | "L" | "pcs";
export type Amount = { amount: number; unit: BaseUnit };

export type Use = {
  dishId: string;
  dish: string;
  course: string;
  serviceDate: string | null;
  perCover: { amount: number; unit: DraftUnit };
  yieldPct: number;
  basis: string;
  role: string;
};

/** One purchase line: an ingredient, possibly used in several dishes. */
export type LineSpec = {
  lineId: string;
  key: string;
  name: string;
  ingredient: DraftIngredient;
  uses: Use[];
  pantry: boolean;
  /** Set when the chef took a proposed fix: what this line stood for before. */
  replaces?: { name: string; fixTitle: string; changesDish: boolean };
};

export type Acceptance = { doubtId: string; by: string; at: string; text: string };

export type LineEdits = {
  struck?: boolean;
  /** Per-cover amount per use (dishId), in the use's unit. */
  perCover?: Record<string, number>;
  yieldPct?: number;
  /** A card the chef chose instead of the best one. */
  optionId?: string;
};

export type FixKind = "substitute" | "change_amount" | "change_dish";
export type FixOption = {
  fixId: string;
  kind: FixKind;
  title: string;
  effect: string;
  changesDish: boolean;
  /** The ingredient to buy instead (substitute, change_dish). */
  ingredient?: DraftIngredient;
  /** For change_amount: the new per-cover amount of this ingredient. */
  perCover?: number;
  /** Plain code's verdict on it, against the catalogue, the rules and live offers. */
  check?: { ok: true; product: string; packs: string; totalCents: number; deltaCents: number | null; deliveryDate: string; orderBy?: string; note?: string } | { ok: false; reason: string };
  source: "model" | "code";
};

/** Live data the plan rests on: one status per priced product, from batched calls. */
export type LiveData = { statuses: Record<string, LiveStatus>; deliverBy: string | null; calls: number; at: string };

export type PlanSettings = { covers: number | null; deliverBy: string | null };

export type PlanInput = {
  draft: MenuDraft;
  specs: LineSpec[];
  candidates: Record<string, { candidates: Candidate[]; rejected: Rejected[]; searched: string[] }>;
  live: LiveData;
  edits: Record<string, LineEdits>;
  acceptances: Acceptance[];
  fixes: Record<string, FixOption[]>;
  settings: PlanSettings;
  mandate: Mandate;
  diet: DietRules;
  now: Date;
  spentThisWeekCents: number;
};

export type DoubtKind = "cannot_arrive" | "no_safe_product" | "no_product" | "not_priced" | "allergen_unknown" | "different_form" | "amount_check" | "rule_conflict";
export type Doubt = { doubtId: string; kind: DoubtKind; text: string; blocking: true; accepted?: Acceptance; acceptLabel?: string };

export type LineStatus = "ready" | "needs_decision" | "struck" | "merged" | "needs_covers";

export type ChosenOption = {
  optionId: string;
  rank: OptionCard["rank"];
  match: OptionCard["match"];
  title: string;
  products: { productId: string; name: string; packs: number; packText: string; unitPriceCents: number; lineTotalCents: number; deliveryDate: string; orderBy?: string; stockKnown?: boolean; substituteFor?: string }[];
  totalCents: number;
  deliveryDate: string;
  orderBy?: string;
  delivered: Amount;
  leftover: Amount;
  pros: string[];
  cons: string[];
  quoteLines: OptionCard["quoteLines"];
};

export type PlanLineView = {
  lineId: string;
  name: string;
  searchTerms: string[];
  roles: string[];
  uses: (Use & { gross: Amount; working: string })[];
  pantry: boolean;
  status: LineStatus;
  statusText: string;
  struckReason?: string;
  mergedInto?: string;
  gross: Amount | null;
  working: string;
  chosen?: ChosenOption & { safety: SafetyCheck[]; fitNotes: string[] };
  alternatives: (ChosenOption & { safety: SafetyCheck[] })[];
  timing: { ok: boolean; text: string } | null;
  doubts: Doubt[];
  fixes: FixOption[];
  excluded: { productId: string; name: string; reason: string }[];
  replaces?: LineSpec["replaces"];
  /** Products of this line that were priced live. */
  priced: string[];
};

export type PlanTotals = {
  totalCents: number;
  lines: number;
  products: number;
  struck: number;
  deliveryDate: string | null;
  orderBy: string | null;
  openDoubts: number;
  signOff: { needed: boolean; reasons: string[]; approver?: { name: string; role: string } };
  budget: { weeklyBudgetCents: number; spentCents: number; afterCents: number; ok: boolean };
  canQuote: boolean;
  blockers: string[];
  /** Clashes the model saw between the request and the kitchen's rules: for the chef to read. */
  warnings: string[];
  /** Set when nothing can arrive by the date asked: the earliest date the products can come. */
  allLate: { neededBy: string; earliest: string | null } | null;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** One ingredient above this per cover is almost certainly a wrong amount or pack (a whole school lunch costs about €3). */
export const MAX_LINE_CENTS_PER_COVER = 400;
export function toBase(amount: number, unit: DraftUnit): Amount {
  return unit === "g" ? { amount: amount / 1000, unit: "kg" } : unit === "ml" ? { amount: amount / 1000, unit: "L" } : { amount, unit: "pcs" };
}
export function formatAmt(a: Amount): string {
  if (a.unit === "pcs") return `${Math.round(a.amount * 10) / 10} pcs`;
  return formatMeasure(r3(a.amount), a.unit);
}
const fmtPer = (amount: number, unit: DraftUnit) => `${Math.round(amount * 10) / 10} ${unit === "pcs" ? "pcs" : unit}`;

/** Per-cover amount x covers / usable share, with the working in words. */
export function useAmount(u: Use, covers: number): { gross: Amount; working: string } {
  const net = toBase(u.perCover.amount * covers, u.perCover.unit);
  const gross = { amount: r3(net.amount / (u.yieldPct / 100)), unit: net.unit };
  const yieldText = u.yieldPct < 100 ? ` ÷ ${u.yieldPct} % usable = ${formatAmt(gross)}` : "";
  return { gross, working: `${fmtPer(u.perCover.amount, u.perCover.unit)} × ${covers} covers = ${formatAmt(net)}${yieldText}` };
}

/** Group the draft's ingredients into purchase lines: the same ingredient key in several dishes is one line. */
export function buildSpecs(draft: MenuDraft, pantryWords: string[]): LineSpec[] {
  const byKey = new Map<string, LineSpec>();
  const pantry = pantryWords.map((w) => w.toLowerCase());
  for (const dish of draft.dishes) {
    for (const ing of dish.ingredients) {
      const use: Use = {
        dishId: dish.id,
        dish: dish.name,
        course: dish.course,
        serviceDate: dish.serviceDate ?? draft.serviceDate,
        perCover: { ...ing.perCover },
        yieldPct: ing.yieldPct,
        basis: ing.amountBasis,
        role: ing.role,
      };
      const existing = byKey.get(ing.key);
      if (existing && existing.ingredient.perCover.unit === ing.perCover.unit) {
        existing.uses.push(use);
        continue;
      }
      const key = existing ? `${ing.key}_${ing.perCover.unit}` : ing.key;
      const inPantry = ing.pantry || pantry.some((w) => ing.name.toLowerCase() === w || ing.key.replace(/_/g, " ") === w);
      byKey.set(key, { lineId: key, key: ing.key, name: ing.name, ingredient: ing, uses: [use], pantry: inPantry });
    }
  }
  return [...byKey.values()];
}

function grossOf(spec: LineSpec, edits: LineEdits | undefined, covers: number) {
  const uses = spec.uses.map((u) => {
    const perCover = edits?.perCover?.[u.dishId] ?? u.perCover.amount;
    const use = { ...u, perCover: { amount: perCover, unit: u.perCover.unit }, yieldPct: edits?.yieldPct ?? u.yieldPct };
    return { ...use, ...useAmount(use, covers) };
  });
  const unit = uses[0]?.gross.unit ?? "kg";
  const gross = { amount: r3(uses.reduce((s, u) => s + u.gross.amount, 0)), unit };
  return { uses, gross };
}

/** The mandate for judging one line on its own: the per-order limit and the budget are judged on the whole plan. */
function lineMandate(m: Mandate): Mandate {
  return { ...m, perOrderLimitCents: Number.MAX_SAFE_INTEGER, weeklyBudgetCents: Number.MAX_SAFE_INTEGER };
}

function toChosen(c: OptionCard, products: Map<string, Product>): ChosenOption {
  return {
    optionId: c.optionId,
    rank: c.rank,
    match: c.match,
    title: c.title,
    products: c.lines.map((l) => {
      const p = products.get(l.productId);
      const label = p?.packContent?.label ?? `${l.packSize} ${l.unit} per pack`;
      return {
        productId: l.productId,
        name: l.name,
        packs: l.packs,
        packText: `${l.packs} × ${p?.salesUnit ?? "pack"} (${label})`,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        deliveryDate: l.deliveryDate,
        ...(l.orderBy ? { orderBy: l.orderBy } : {}),
        ...(l.stockKnown === false ? { stockKnown: false } : {}),
        ...(l.substituteFor ? { substituteFor: l.substituteFor } : {}),
      };
    }),
    totalCents: c.totalCents,
    deliveryDate: c.deliveryDate,
    ...(c.orderBy ? { orderBy: c.orderBy } : {}),
    delivered: { amount: c.delivered.amount, unit: c.delivered.unit === "L" ? "L" : c.delivered.unit === "kg" ? "kg" : "pcs" },
    leftover: { amount: c.leftover.amount, unit: c.leftover.unit === "L" ? "L" : c.leftover.unit === "kg" ? "kg" : "pcs" },
    pros: c.pros,
    cons: c.cons.filter((x) => !/per-order limit|weekly budget/.test(x)),
    quoteLines: c.quoteLines,
  };
}

/** Options for one amount of one line's priced candidates, through the core's good-better-best ranking. */
export function optionsFor(amount: Amount, candidates: Candidate[], live: LiveData, mandate: Mandate, now: Date, neededBy: string | null) {
  const statuses = candidates.map((c) => live.statuses[c.product.id]).filter((s): s is LiveStatus => !!s);
  const offers = statuses.map(usableOffer).filter((o): o is LiveOffer => !!o);
  const products = candidates.filter((c) => live.statuses[c.product.id]).map((c) => c.product);
  const res = buildOptions({
    amount: { amount: amount.amount, unit: amount.unit },
    candidates: products,
    offers,
    statuses,
    mandate: lineMandate(mandate),
    now,
    ...(neededBy ? { neededBy } : {}),
    spentThisWeekCents: 0,
    goal: "price",
  });
  return res;
}

const doubtId = (lineId: string, kind: DoubtKind, extra = "") => `${lineId}:${kind}${extra ? `:${extra}` : ""}`;

function evaluateLine(spec: LineSpec, input: PlanInput): PlanLineView {
  const edits = input.edits[spec.lineId];
  const covers = input.settings.covers;
  const set = input.candidates[spec.lineId] ?? { candidates: [], rejected: [], searched: [] };
  const priced = set.candidates.filter((c) => input.live.statuses[c.product.id]).map((c) => c.product.id);
  const base: PlanLineView = {
    lineId: spec.lineId,
    name: spec.name,
    searchTerms: spec.ingredient.searchTerms,
    roles: [...new Set(spec.uses.map((u) => `${u.role} (${u.dish})`))],
    uses: [],
    pantry: spec.pantry,
    status: "ready",
    statusText: "",
    gross: null,
    working: "",
    alternatives: [],
    timing: null,
    doubts: [],
    fixes: input.fixes[spec.lineId] ?? [],
    excluded: set.rejected.map((r) => ({ productId: r.productId, name: r.name, reason: r.reason })),
    ...(spec.replaces ? { replaces: spec.replaces } : {}),
    priced,
  };
  const struck = edits?.struck ?? spec.pantry;
  if (covers === null) {
    return { ...base, status: "needs_covers", statusText: "Give the number of covers to work out the amount." };
  }
  const { uses, gross } = grossOf(spec, edits, covers);
  const view: PlanLineView = { ...base, uses, gross, working: uses.length > 1 ? `${uses.map((u) => u.working.split(" = ").slice(-1)[0]).join(" + ")} = ${formatAmt(gross)}` : (uses[0]?.working ?? "") };
  if (struck) {
    return { ...view, status: "struck", statusText: edits?.struck === undefined ? "Assumed in stock" : "Struck by the chef", struckReason: edits?.struck === undefined ? "a pantry staple this kitchen keeps; tap to order it" : "the kitchen has it or buys it elsewhere" };
  }
  const accepted = (id: string) => input.acceptances.find((a) => a.doubtId === id);
  const addDoubt = (kind: DoubtKind, text: string, acceptLabel?: string, extra = "") => {
    const id = doubtId(spec.lineId, kind, extra);
    view.doubts.push({ doubtId: id, kind, text, blocking: true, ...(acceptLabel ? { acceptLabel } : {}), ...(accepted(id) ? { accepted: accepted(id) } : {}) });
  };

  // What the code thinks of the model's amounts.
  for (const c of input.draft.corrections) if (c.toLowerCase().includes(spec.name.toLowerCase()) && /beyond|no usable amount/.test(c)) addDoubt("amount_check", c, "The amount is right");
  const allergenRefused = set.rejected.some((r) => /contains|may contain/.test(r.reason));
  const keyWords = spec.key.split("_").filter((w) => w.length >= 4);
  const conflict = input.draft.conflicts.find((c) => keyWords.some((w) => c.toLowerCase().includes(w)));
  if (conflict && allergenRefused) addDoubt("rule_conflict", `The request clashes with a kitchen rule: ${conflict}`, undefined, "conflict");
  if (spec.uses.some((u) => u.perCover.unit === "pcs")) {
    addDoubt("amount_check", "Counted in pieces, but the catalogue's packs are not counted in pieces, so Dock will not guess how many packs that is. Give the amount per cover in g or ml, or strike the line.", undefined, "pieces");
    return finish(view);
  }

  if (gross.amount <= 0) {
    addDoubt("amount_check", "No amount per cover: fill it in or strike the line.");
    return finish(view);
  }
  if (set.candidates.length === 0) {
    const unsafe = set.rejected.filter((r) => /contains|may contain|allergen data|lactose-free|claim/.test(r.reason));
    if (unsafe.length) addDoubt("no_safe_product", `No product found for ${spec.name} that meets the kitchen's rules: ${unsafe.slice(0, 3).map((r) => `${r.name} (${r.reason})`).join("; ")}.`);
    else addDoubt("no_product", `No product in the catalogue fits ${spec.name} for this use (searched: ${set.searched.join(", ")}).`);
    return finish(view);
  }
  if (priced.length === 0) {
    addDoubt("not_priced", `${spec.name} has not been priced yet: live prices are fetched for a short list only.`);
    return finish(view);
  }
  // Products whose allergen data shows the rules are met go first; held ones only if nothing else can be had.
  const pricedCands = set.candidates.filter((c) => priced.includes(c.product.id));
  const okCands = pricedCands.filter((c) => c.safety.verdict === "ok");
  let res = optionsFor(gross, okCands.length ? okCands : pricedCands, input.live, input.mandate, input.now, input.settings.deliverBy);
  if (okCands.length && res.cards.length === 0 && okCands.length < pricedCands.length) res = optionsFor(gross, pricedCands, input.live, input.mandate, input.now, input.settings.deliverBy);
  const products = new Map(set.candidates.map((c) => [c.product.id, c.product]));
  const names = new Map(set.candidates.map((c) => [c.product.id, c.product.name]));
  view.excluded.unshift(...res.excluded.map((e) => ({ productId: e.productId, name: names.get(e.productId) ?? e.productId, reason: e.reason })));

  if (res.cards.length === 0) {
    const cut = res.excluded.filter((e) => e.code === "cutoff_passed" || e.code === "too_late" || e.code === "out_of_stock" || e.code === "blocked" || e.code === "no_offer");
    const why = cut.length ? cut.map((e) => `${names.get(e.productId) ?? e.productId}: ${e.reason}`).join("; ") : res.excluded.map((e) => `${names.get(e.productId) ?? e.productId}: ${e.reason}`).join("; ");
    view.timing = { ok: false, text: `Cannot arrive${input.settings.deliverBy ? ` by ${formatDay(input.settings.deliverBy)}` : ""}: ${why}.` };
    addDoubt("cannot_arrive", view.timing.text);
    return finish(view);
  }
  const card = res.cards.find((c) => c.optionId === edits?.optionId) ?? res.cards[0];
  const candOf = (id: string) => set.candidates.find((c) => c.product.id === id);
  const main = candOf(card.lines[0].productId);
  view.chosen = { ...toChosen(card, products), safety: main?.safety.checks ?? [], fitNotes: main?.why ?? [] };
  view.alternatives = res.cards.filter((c) => c !== card).map((c) => ({ ...toChosen(c, products), safety: candOf(c.lines[0].productId)?.safety.checks ?? [] }));
  const late = card.match === "compromise" && card.givesUp.some((g) => g.part === "delivery_date");
  view.timing = late
    ? { ok: false, text: card.givesUp.map((g) => g.text).join(" ") }
    : { ok: true, text: `Arrives ${formatDay(card.deliveryDate)}${card.orderBy ? `, if ordered by ${formatCutoff(card.orderBy)}` : ""}.` };
  if (late) addDoubt("cannot_arrive", view.timing.text, "Accept the later delivery", "late");
  // A line that costs more per cover than a whole lunch usually does is a wrong amount or a wrong pack, whatever made it.
  const perCoverCents = card.totalCents / covers;
  if (perCoverCents > MAX_LINE_CENTS_PER_COVER) addDoubt("amount_check", `${spec.name} comes to ${formatEur(Math.round(perCoverCents))} per cover (${formatEur(card.totalCents)} in all), more than a whole lunch usually costs: check the amount and the packs.`, "The amount is right", "cost");
  for (const l of card.lines) {
    const c = candOf(l.productId);
    if (c?.safety.verdict === "hold") addDoubt("allergen_unknown", `${c.product.name}: ${safetyProblem(c.safety)}. A person must check the product before it is ordered.`, "I checked the product: it is safe here", l.productId);
  }
  const form = main?.why.find((w) => /not fresh|not frozen|room temperature|, not /.test(w));
  if (main && form) addDoubt("different_form", `${main.product.name} is the closest product that meets the rules, but it is ${form}, where the dish asks for ${spec.ingredient.form.replace(/_/g, " ")}. Check it works for ${spec.uses[0]?.dish ?? "the dish"}.`, "Use it", main.product.id);
  return finish(view);
}

function finish(v: PlanLineView): PlanLineView {
  const open = v.doubts.filter((d) => !d.accepted);
  v.status = open.length ? "needs_decision" : "ready";
  v.statusText = open.length ? open.map((d) => d.text).join(" ") : v.chosen ? `${v.chosen.products.map((p) => p.packText).join(" + ")}` : "";
  return v;
}

/** Lines that chose the same product become one purchase: amounts added, then rounded to packs once. */
function mergeShared(lines: PlanLineView[], specs: LineSpec[], input: PlanInput): void {
  const owner = new Map<string, PlanLineView>();
  for (const v of lines) {
    if (v.status === "struck" || !v.chosen || v.chosen.products.length !== 1 || !v.gross) continue;
    const pid = v.chosen.products[0].productId;
    const first = owner.get(pid);
    if (!first) {
      owner.set(pid, v);
      continue;
    }
    if (first.gross!.unit !== v.gross.unit) continue;
    const amount = { amount: r3(first.gross!.amount + v.gross.amount), unit: v.gross.unit };
    const cands = (input.candidates[first.lineId]?.candidates ?? []).filter((c) => c.product.id === pid);
    const res = optionsFor(amount, cands, input.live, input.mandate, input.now, input.settings.deliverBy);
    const card = res.cards[0];
    if (!card) continue;
    const products = new Map(cands.map((c) => [c.product.id, c.product]));
    first.chosen = { ...toChosen(card, products), safety: first.chosen!.safety, fitNotes: [...first.chosen!.fitNotes, `combined with ${v.name}: ${formatAmt(first.gross!)} + ${formatAmt(v.gross)} = ${formatAmt(amount)}`] };
    first.gross = amount;
    first.working = `${first.working}; with ${v.name} (${v.working}): ${formatAmt(amount)} in all`;
    first.statusText = first.status === "ready" ? first.chosen.products.map((p) => p.packText).join(" + ") : first.statusText;
    first.doubts.push(...v.doubts);
    v.status = "merged";
    v.mergedInto = first.lineId;
    v.statusText = `Bought together with ${first.name}`;
    v.doubts = [];
    v.chosen = undefined;
    void specs;
  }
}

function pickApprover(m: Mandate, total: number) {
  return [...m.approvers].filter((a) => a.maxApprovalCents >= total).sort((a, b) => a.maxApprovalCents - b.maxApprovalCents)[0];
}

export type PlanView = { lines: PlanLineView[]; totals: PlanTotals };

export function computePlan(input: PlanInput): PlanView {
  const lines = input.specs.map((s) => evaluateLine(s, input));
  mergeShared(lines, input.specs, input);
  const buying = lines.filter((l) => l.status === "ready" || l.status === "needs_decision");
  const chosen = buying.filter((l) => l.chosen);
  const totalCents = chosen.reduce((s, l) => s + l.chosen!.totalCents, 0);
  const productIds = new Set(chosen.flatMap((l) => l.chosen!.products.map((p) => p.productId)));
  const openDoubts = lines.reduce((n, l) => n + l.doubts.filter((d) => !d.accepted).length, 0);
  const dates = chosen.flatMap((l) => l.chosen!.products.map((p) => p.deliveryDate)).sort();
  const cutoffs = chosen.flatMap((l) => l.chosen!.products.map((p) => p.orderBy).filter((x): x is string => !!x)).sort();
  const m = input.mandate;
  const reasons: string[] = [];
  if (totalCents > m.perOrderLimitCents) reasons.push(`${formatEur(totalCents)} is over the ${formatEur(m.perOrderLimitCents)} the agent may spend alone.`);
  if (chosen.some((l) => l.chosen!.products.some((p) => p.substituteFor)) && m.substitution.rule === "needs_approval") reasons.push("A line splits across a substitute product: the mandate sends every substitute to a person.");
  const approver = reasons.length ? pickApprover(m, totalCents) : undefined;
  const after = input.spentThisWeekCents + totalCents;
  const blockers: string[] = [];
  if (input.settings.covers === null) blockers.push("Give the number of covers.");
  if (openDoubts) blockers.push(`${openDoubts} item${openDoubts > 1 ? "s" : ""} on the plan need${openDoubts > 1 ? "" : "s"} a decision.`);
  if (chosen.length === 0 && input.settings.covers !== null) blockers.push("Nothing to order: every line is struck.");
  if (productIds.size > MAX_LIVE_IDS_PER_CALL)
    blockers.push(`${productIds.size} products: the wholesaler fixes a price for at most ${MAX_LIVE_IDS_PER_CALL} products in one quote today. Strike ${productIds.size - MAX_LIVE_IDS_PER_CALL} line${productIds.size - MAX_LIVE_IDS_PER_CALL > 1 ? "s" : ""} the kitchen can cover, or plan fewer dishes; Dock does not split one need into several orders.`);
  if (after > m.weeklyBudgetCents) blockers.push(`${formatEur(totalCents)} would take this week's spend to ${formatEur(after)}, over the ${formatEur(m.weeklyBudgetCents)} budget.`);
  if (reasons.length && !approver) blockers.push(`No one in the mandate may sign off ${formatEur(totalCents)}.`);
  // Nothing can come by the date: one message for the plan instead of one per line.
  const open = lines.filter((l) => (l.status === "ready" || l.status === "needs_decision") && l.gross);
  const late = open.filter((l) => l.doubts.some((d) => d.kind === "cannot_arrive" && !d.accepted));
  let allLate: PlanTotals["allLate"] = null;
  if (input.settings.deliverBy && open.length >= 2 && late.length === open.length) {
    const earliest = late.flatMap((l) => [l.chosen?.deliveryDate, ...l.alternatives.map((a) => a.deliveryDate)]).filter((d): d is string => !!d).sort()[0] ?? null;
    allLate = { neededBy: input.settings.deliverBy, earliest };
    blockers.unshift(`Nothing on this plan can arrive by ${formatDay(input.settings.deliverBy)}${earliest ? `: the earliest delivery is ${formatDay(earliest)}` : ""}. Move the date, or buy locally.`);
  }
  return {
    lines,
    totals: {
      totalCents,
      lines: chosen.length,
      products: productIds.size,
      struck: lines.filter((l) => l.status === "struck").length,
      deliveryDate: dates.at(-1) ?? null,
      orderBy: cutoffs[0] ?? null,
      openDoubts,
      signOff: { needed: reasons.length > 0, reasons, ...(approver ? { approver: { name: approver.name, role: approver.role } } : {}) },
      budget: { weeklyBudgetCents: m.weeklyBudgetCents, spentCents: input.spentThisWeekCents, afterCents: after, ok: after <= m.weeklyBudgetCents },
      canQuote: blockers.length === 0,
      blockers,
      warnings: input.draft.conflicts,
      allLate,
    },
  };
}

/** The products worth one batched live call: the best few per line that is being bought, at most `max` in all. */
export function liveShortlist(specs: LineSpec[], candidates: PlanInput["candidates"], edits: Record<string, LineEdits>, opts: { perLine: number; max: number; already?: string[] }): string[] {
  const out: string[] = [];
  const already = new Set(opts.already ?? []);
  const active = specs.filter((s) => !(edits[s.lineId]?.struck ?? s.pantry));
  for (let round = 0; round < opts.perLine; round++) {
    for (const s of active) {
      const c = (candidates[s.lineId]?.candidates ?? []).filter((x) => x.safety.verdict === "ok" || round > 0)[round] ?? candidates[s.lineId]?.candidates[round];
      if (c && !out.includes(c.product.id) && !already.has(c.product.id) && out.length < opts.max) out.push(c.product.id);
    }
  }
  return out;
}
