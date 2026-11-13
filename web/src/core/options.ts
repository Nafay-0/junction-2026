import { usableOffer, type LiveOffer, type LiveStatus, type Product } from "./catalog";
import { packsFor as convertPacks } from "./catalog/product";
import { formatDay, primaryLine, type HistoryEntry } from "./kitchen";
import type { Mandate } from "./mandate";
import { formatAmount, type BaseUnit, type OptimiseGoal } from "./need";
import type { QuoteRequestLine } from "./quote";
import { addDays, formatEur, isoDate } from "./util";
import { isMaterialAttribute } from "./vocabulary";

/**
 * Option cards, ranked good, better, best (the partner's phrase). Every figure comes from master data or the live
 * offer; pros and cons are templates comparing the cards with each other.
 *
 * - When everything asked for can be met, only full matches are shown, ranked by the buyer's goal (price when none
 *   is known), each labelled by what it is best at (best price, lowest carbon, most reliable, same as last time).
 * - When it cannot, every card is a compromise and says which part of the request it gives up: a later delivery
 *   day, the product named (a substitute), its pack size, or a split across two products. A compromise is never
 *   labelled a match, and the agent never picks one alone (see intake.ts).
 * - Products that cannot be had at all are listed in `excluded` with the reason, a passed order cut-off first-class.
 *
 * Cards already respect the hard constraints (the caller filters products) and what the mandate checks: delivery
 * deadline, substitution rule and price tolerance, and the weekly budget. A card over the per-order limit is kept
 * and says it needs a sign-off.
 */

export type OptionLabel = "best_price" | "lowest_carbon" | "most_reliable" | "same_as_last_time";
export const LABEL_TEXT: Record<OptionLabel, string> = {
  best_price: "Best price",
  lowest_carbon: "Lowest carbon",
  most_reliable: "Most reliable delivery",
  same_as_last_time: "Same as last time",
};

export type Rank = "best" | "better" | "good";
const RANKS: Rank[] = ["best", "better", "good"];

/** A part of the request an option does not meet. */
export type GiveUp = { part: "delivery_date" | "product" | "pack_size" | "split"; text: string };

export type PlanLine = {
  productId: string;
  name: string;
  packs: number;
  packSize: number; // base units (L, kg, pcs) in one pack, as used for this card
  unit: BaseUnit;
  unitPriceCents: number; // per pack
  lineTotalCents: number;
  deliveryDate: string;
  substituteFor?: string;
  /** The order cut-off for this delivery date, when the wholesaler states one. */
  orderBy?: string;
  /** False when the wholesaler reports no real stock figure for the product. */
  stockKnown?: boolean;
  /** True when packs come from an estimate of the pack content the buyer confirmed. */
  estimated?: boolean;
  /** Signed claims behind this line's price, availability and origin (see claims.ts). */
  claims?: LiveOffer["claims"];
};

export type OptionCard = {
  optionId: string;
  /** Good, better, best: the order of the cards by the buyer's goal (price when none is known). */
  rank: Rank;
  /** "full": meets everything the request asks; "compromise": gives up what `givesUp` says. */
  match: "full" | "compromise";
  givesUp: GiveUp[];
  labels: OptionLabel[];
  title: string;
  lines: PlanLine[];
  totalCents: number;
  deliveryDate: string;
  /** The earliest order cut-off among the lines: after it, this card no longer holds. */
  orderBy?: string;
  /** False when any line's stock is not reported by the wholesaler. */
  stockConfirmed: boolean;
  delivered: { amount: number; unit: BaseUnit };
  leftover: { amount: number; unit: BaseUnit };
  /** kg CO2e for the whole order, from the product group's average footprint; null when there is no data. */
  co2: { kg: number; basis: "product_group_average" } | { kg: null; basis: "missing" };
  /** Share of past deliveries made in full, from the partner's reliability file; null when there is no data. */
  reliability: number | null;
  signOff: string[]; // why a person will have to approve this option
  pros: string[];
  cons: string[];
  quoteLines: QuoteRequestLine[]; // what to send to POST /api/v1/quotes
};

/** The product the request is about: one the buyer named, the one ordered last time ("same as last time"), or the kitchen's usual. */
export type Reference = { productId: string; name: string; source: "named" | "last" | "usual" };

export type OptionsInput = {
  amount: { amount: number; unit: BaseUnit };
  candidates: Product[];
  offers: LiveOffer[];
  /** One live status per priced product: why a product has no usable offer (cut-off passed, sales block, ...). */
  statuses?: LiveStatus[];
  mandate: Mandate;
  now: Date;
  neededBy?: string;
  spentThisWeekCents: number;
  last?: HistoryEntry;
  usual?: { productId: string; text: string }; // learned usual product, for a "your usual" pro
  reference?: Reference;
  /** The buyer's goal, for the good-better-best order. Default: price. */
  goal?: OptimiseGoal;
  /** Products whose estimated pack content the buyer confirmed (concern pack_uncertain). */
  estimates?: string[];
  /**
   * What the buyer left open (fat content, say), as a key per product: the cards then show the best option for
   * each value instead of three of the same kind, and the buyer picks by choosing a card rather than answering first.
   */
  span?: (p: Product) => string | undefined;
};

export type ExclusionCode = "no_offer" | "cutoff_passed" | "out_of_stock" | "too_late" | "pack_uncertain" | "wrong_unit" | "over_budget" | "no_substitute" | "blocked" | "compromise";
export type Exclusion = { productId: string; reason: string; code?: ExclusionCode };
export type OptionsResult = { cards: OptionCard[]; excluded: Exclusion[]; notes: string[] };

// ---------- thresholds ----------

/** Reliability gaps below 2 points are within the noise of the partner's history file. */
export const RELIABILITY_GAP = 0.02;
/** From this many packs, handling effort is worth a mention when another option needs half as many. */
export const MANY_PACKS = 40;
/** Good, better, best: three cards are enough to compare; more and nobody reads the third. */
export const MAX_CARDS = 3;
/** A cut-off this close is worth saying on the card: the buyer may not have the time they think. */
export const CUTOFF_SOON_HOURS = 12;

/** Read a figure that may be missing in real data (only a quarter of products have a reliability value). */
export function known(n: number | null | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** A partner time stamp ("2026-11-12T15:00:00+0200") as "Thu 12 Nov 15:00". */
export function formatCutoff(orderBy: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(orderBy) ? `${formatDay(orderBy.slice(0, 10))} ${orderBy.slice(11, 16)}` : orderBy;
}

/**
 * Products worth a live price call: the reference, last and usual products first, then in turn the biggest packs
 * (for a large order, fewer packs to handle), the most reliable and the lowest-carbon ones.
 */
export function shortlist(candidates: Product[], prefer: (string | undefined)[], max: number, amount?: { amount: number; unit: BaseUnit }, span?: (p: Product) => string | undefined): Product[] {
  if (candidates.length <= max) return candidates;
  const byRel = [...candidates].sort((a, b) => (known(b.deliveryReliability) ?? -1) - (known(a.deliveryReliability) ?? -1) || a.id.localeCompare(b.id));
  const byCo2 = [...candidates].sort((a, b) => (carbonOf(a) ?? Infinity) - (carbonOf(b) ?? Infinity) || a.id.localeCompare(b.id));
  const big = amount && amount.unit !== "pcs" && amount.amount >= 100;
  const byPack = big ? [...candidates].filter((p) => p.unit === amount.unit).sort((a, b) => b.packSize - a.packSize || a.id.localeCompare(b.id)) : [];
  const ids: string[] = [...new Set(prefer.filter((x): x is string => !!x && candidates.some((p) => p.id === x)))];
  if (span) {
    // Each value the buyer left open gets its best few products priced, so the cards can show every kind.
    // Products whose value is unknown ("?", say a 3 % milk the fat question does not name) come last.
    const keys = [...new Set(candidates.map(span))].sort((a, b) => Number(a?.includes("?")) - Number(b?.includes("?")));
    const known = keys.filter((k) => !k?.includes("?"));
    const per = Math.max(1, Math.floor((max - ids.length) / Math.max(known.length, 1)));
    for (const key of keys) {
      const lists = [byPack, byRel, byCo2].map((l) => l.filter((p) => span(p) === key));
      const mine: string[] = [];
      for (let i = 0; mine.length < per && i < candidates.length; i++) for (const l of lists) if (l[i] && !ids.includes(l[i].id) && !mine.includes(l[i].id) && mine.length < per) mine.push(l[i].id);
      ids.push(...mine.slice(0, Math.max(0, max - ids.length)));
    }
  }
  for (let i = 0; ids.length < max && i < candidates.length; i++) {
    for (const p of [byPack[i], byRel[i], byCo2[i]]) if (p && !ids.includes(p.id) && ids.length < max) ids.push(p.id);
  }
  return ids.map((id) => candidates.find((p) => p.id === id)!);
}

const carbonOf = (p: Product) => (p.carbonKnown === false ? undefined : known(p.carbonKgPerUnit) || undefined);

type Sized = { perPack: number; unit: BaseUnit; packs: number; estimated: boolean };
type Viable = { p: Product; o: LiveOffer; size: Sized; late: boolean; stockKnown: boolean };
type Plan = { primary: Viable; lines: PlanLine[]; split?: { have: number; rest: number; sub: Viable }; late: boolean; replaces?: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** How many packs of a product make the amount, using the partner's pack data when there is some. */
function sizeFor(p: Product, amount: { amount: number; unit: BaseUnit }, estimates: string[]): Sized | { error: string; code: ExclusionCode } {
  if (amount.unit === "pcs" || !p.packContent) {
    if (p.unit !== amount.unit) return { error: `sold by ${p.unit}, not ${amount.unit}`, code: "wrong_unit" };
    return { perPack: p.packSize, unit: p.unit, packs: Math.ceil(amount.amount / p.packSize - 1e-9), estimated: false };
  }
  const conv = convertPacks(p, { amount: amount.amount, unit: amount.unit });
  if (conv.ok) return { perPack: conv.perSalesUnit.amount, unit: amount.unit, packs: conv.salesUnits, estimated: false };
  if (conv.reason === "content_uncertain" && conv.estimate && estimates.includes(p.id)) {
    return { perPack: r2(conv.estimate.delivered.amount / conv.estimate.salesUnits), unit: amount.unit, packs: conv.estimate.salesUnits, estimated: true };
  }
  if (conv.reason === "content_uncertain" || conv.reason === "content_unknown") return { error: `pack content not certain, so Dock will not guess the number of packs (${conv.message})`, code: "pack_uncertain" };
  return { error: conv.message, code: "wrong_unit" };
}

function whyNoOffer(st: LiveStatus | undefined, neededBy: string | undefined): { reason: string; code: ExclusionCode } {
  if (!st) return { reason: "no live offer right now", code: "no_offer" };
  if (st.problems.includes("cutoff_passed")) {
    const by = st.offer?.orderBy;
    const date = st.offer?.deliveryDate ?? neededBy;
    return {
      reason: `order cut-off${by ? ` ${formatCutoff(by)}` : ""} has passed, so it cannot arrive${date ? ` ${formatDay(date)}` : " on the date asked"}; the wholesaler's service names no later date yet`,
      code: "cutoff_passed",
    };
  }
  if (st.problems.includes("sales_block")) return { reason: "the wholesaler has blocked sales of it right now", code: "blocked" };
  if (st.problems.includes("not_deliverable")) return { reason: "cannot be delivered on any date right now", code: "blocked" };
  if (st.problems.includes("no_price") || st.problems.includes("price_not_valid")) return { reason: "no valid price right now", code: "no_offer" };
  return { reason: st.message, code: "no_offer" };
}

export function buildOptions(input: OptionsInput): OptionsResult {
  const { amount, mandate } = input;
  const excluded: Exclusion[] = [];
  const notes: string[] = [];
  const leadLimit = isoDate(addDays(input.now, mandate.delivery.maxLeadDays));
  const latest = input.neededBy && input.neededBy < leadLimit ? input.neededBy : leadLimit;
  const statusOf = new Map((input.statuses ?? []).map((s) => [s.productId, s]));
  const offerOf = new Map(input.offers.map((o) => [o.productId, o]));
  for (const s of input.statuses ?? []) {
    const u = usableOffer(s);
    if (u && !offerOf.has(s.productId)) offerOf.set(s.productId, u);
  }
  const estimates = input.estimates ?? [];

  const viable: Viable[] = [];
  for (const p of input.candidates) {
    const o = offerOf.get(p.id);
    if (!o) {
      const why = whyNoOffer(statusOf.get(p.id), input.neededBy);
      excluded.push({ productId: p.id, reason: why.reason, code: why.code });
      continue;
    }
    const size = sizeFor(p, amount, estimates);
    if ("error" in size) {
      excluded.push({ productId: p.id, reason: size.error, code: size.code });
      continue;
    }
    const stockKnown = o.stockKnown !== false;
    if (stockKnown && o.availablePacks <= 0) excluded.push({ productId: p.id, reason: "out of stock", code: "out_of_stock" });
    else if (o.deliveryDate > leadLimit) excluded.push({ productId: p.id, reason: `earliest delivery ${formatDay(o.deliveryDate)} is after ${formatDay(leadLimit)}, the latest the mandate allows`, code: "too_late" });
    else viable.push({ p, o, size, late: o.deliveryDate > latest, stockKnown });
  }

  const line = (v: Viable, packs: number, substituteFor?: string): PlanLine => ({
    productId: v.p.id,
    name: v.p.name,
    packs,
    packSize: v.size.perPack,
    unit: v.size.unit,
    unitPriceCents: v.o.unitPriceCents,
    lineTotalCents: packs * v.o.unitPriceCents,
    deliveryDate: v.o.deliveryDate,
    ...(substituteFor ? { substituteFor } : {}),
    ...(v.o.orderBy ? { orderBy: v.o.orderBy } : {}),
    ...(v.stockKnown ? {} : { stockKnown: false }),
    ...(v.size.estimated ? { estimated: true } : {}),
    ...(v.o.claims ? { claims: v.o.claims } : {}),
  });
  const perUnit = (v: Viable) => v.o.unitPriceCents / v.size.perPack;
  const enough = (v: Viable, units: number) => !v.stockKnown || v.o.availablePacks * v.size.perPack >= units - 1e-9;

  const plans: Plan[] = [];
  for (const v of viable) {
    if (enough(v, amount.amount)) {
      plans.push({ primary: v, lines: [line(v, v.size.packs)], late: v.late });
      continue;
    }
    const have = v.o.availablePacks * v.size.perPack;
    const rest = amount.amount - have;
    const stockNote = `only ${formatAmount(have, v.size.unit)} in stock`;
    if (mandate.substitution.rule === "none") {
      excluded.push({ productId: v.p.id, reason: `${stockNote}, and the mandate allows no substitutes`, code: "no_substitute" });
      continue;
    }
    const sub = viable
      .filter((q) => q !== v && q.late === v.late && enough(q, rest))
      .filter((q) => likeForLike(v.p, q.p)) // the rest of the same milk: never 400 L skimmed topped up with semi-skimmed
      .filter((q) => (perUnit(q) / perUnit(v) - 1) * 100 <= mandate.substitution.maxPriceIncreasePct + 1e-9)
      .sort((a, b) => perUnit(a) - perUnit(b) || a.p.id.localeCompare(b.p.id))[0];
    if (!sub) {
      excluded.push({ productId: v.p.id, reason: `${stockNote}, and no substitute within the mandate covers the rest`, code: "no_substitute" });
      continue;
    }
    const subPacks = Math.ceil(rest / sub.size.perPack - 1e-9);
    plans.push({ primary: v, lines: [line(v, v.o.availablePacks), line(sub, subPacks, v.p.id)], split: { have, rest, sub }, late: v.late });
  }

  // The reference product cannot do it on time: other products take its place, as substitutes the gate can check.
  const ref = input.reference;
  const refViable = ref && viable.find((v) => v.p.id === ref.productId);
  const refFull = ref && plans.some((pl) => pl.primary.p.id === ref.productId && !pl.split && !pl.late);
  const refPriced = ref && (offerOf.get(ref.productId) ?? statusOf.get(ref.productId)?.offer);
  if (ref && !refFull) {
    const why = refViable ? (refViable.late ? `it arrives ${formatDay(refViable.o.deliveryDate)}` : "not enough in stock") : (excluded.find((e) => e.productId === ref.productId)?.reason ?? "it was not priced");
    for (const pl of plans) {
      if (pl.primary.p.id === ref.productId || pl.split) continue;
      pl.replaces = ref.productId;
      if (refPriced) pl.lines = pl.lines.map((l) => ({ ...l, substituteFor: l.substituteFor ?? ref.productId }));
    }
    if (ref.source !== "last" || !input.last) notes.push(`${ref.source === "usual" ? "Your usual" : ref.source === "last" ? "Same as last time" : "The product you named"} (${ref.name}) cannot do it: ${why}.`);
  }

  const total = (pl: Plan) => pl.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const affordable = plans.filter((pl) => {
    const over = input.spentThisWeekCents + total(pl) > mandate.weeklyBudgetCents;
    if (over) excluded.push({ productId: pl.primary.p.id, reason: `${formatEur(total(pl))} would go over the weekly budget (${formatEur(mandate.weeklyBudgetCents - input.spentThisWeekCents)} left)`, code: "over_budget" });
    return !over;
  });

  const givesUp = (pl: Plan): GiveUp[] => {
    const out: GiveUp[] = [];
    const date = pl.lines.map((l) => l.deliveryDate).sort().at(-1)!;
    if (pl.late && input.neededBy) out.push({ part: "delivery_date", text: `Arrives ${formatDay(date)}, after the ${formatDay(input.neededBy)} you asked for.` });
    // A split or another product gives up something only when the request was about one product (named, or the
    // one ordered last time). Without that, two like-for-like products delivering everything is a full match.
    if (ref && ref.source !== "usual") {
      const named = ref.source === "named" ? "the product you named" : "the product you ordered last time";
      if (pl.split && pl.primary.p.id === ref.productId) {
        out.push({ part: "split", text: `Split across two products: only ${formatAmount(r2(pl.split.have), amount.unit)} of ${ref.name}, the rest from ${pl.split.sub.p.name}.` });
      } else if (pl.lines.some((l) => l.productId !== ref.productId)) {
        out.push({ part: "product", text: `Not ${named} (${ref.name}): ${pl.lines.filter((l) => l.productId !== ref.productId).map((l) => l.name).join(", ")} instead.` });
        const refProduct = input.candidates.find((p) => p.id === ref.productId);
        const refSized = refProduct ? sizeFor(refProduct, amount, estimates) : undefined;
        const refSize = refSized && !("error" in refSized) ? refSized.perPack : undefined;
        const other = pl.lines.find((l) => l.productId !== ref.productId && refSize !== undefined && Math.abs(l.packSize - refSize) > 1e-9);
        if (other && refSize !== undefined) out.push({ part: "pack_size", text: `Packs of ${formatAmount(other.packSize, amount.unit)} instead of ${formatAmount(refSize, amount.unit)}.` });
      }
    }
    return out;
  };

  const full = affordable.filter((pl) => givesUp(pl).length === 0);
  const pool = full.length ? full : affordable;
  if (!full.length && affordable.length) notes.push("Nothing meets the whole request, so every option below says what it gives up.");
  for (const pl of affordable.filter((x) => full.length && !full.includes(x))) {
    excluded.push({ productId: pl.primary.p.id, reason: `${givesUp(pl).map((g) => g.text.replace(/\.$/, "")).join("; ")}: not offered, because other options meet the whole request`, code: "compromise" });
  }

  const metrics = new Map(pool.map((pl) => [pl, measure(pl, input)]));
  const m = (pl: Plan) => metrics.get(pl)!;
  const goal = input.goal ?? "price";
  const goalKey = (pl: Plan) => (goal === "co2" ? (m(pl).co2 ?? Infinity) : goal === "reliability" ? -(m(pl).rel ?? -1) : m(pl).total);
  const ranked = [...pool].sort(
    (a, b) =>
      givesUp(a).length - givesUp(b).length ||
      goalKey(a) - goalKey(b) ||
      m(a).total - m(b).total ||
      (m(a).co2 ?? Infinity) - (m(b).co2 ?? Infinity) ||
      (m(b).rel ?? -1) - (m(a).rel ?? -1) ||
      a.primary.p.id.localeCompare(b.primary.p.id),
  );
  const byPrice = [...pool].sort((a, b) => m(a).total - m(b).total || ranked.indexOf(a) - ranked.indexOf(b));
  const withCo2 = byPrice.filter((pl) => m(pl).co2 !== null);
  const withRel = byPrice.filter((pl) => m(pl).rel !== null);
  const picks: [OptionLabel, Plan | undefined][] = [
    ["best_price", byPrice[0]],
    ["lowest_carbon", [...withCo2].sort((a, b) => m(a).co2! - m(b).co2!)[0]], // stable sort: ties go to the cheaper
    ["most_reliable", [...withRel].sort((a, b) => m(b).rel! - m(a).rel!)[0]],
  ];
  if (pool.length && !withCo2.length) notes.push("No carbon data for any of these products, so there is no lowest-carbon option.");
  if (pool.length && !withRel.length) notes.push("No delivery-reliability data for any of these products, so there is no most-reliable option.");
  if (input.last) {
    const lastId = primaryLine(input.last).productId;
    const same = pool.find((pl) => pl.primary.p.id === lastId && !pl.split);
    if (same) picks.push(["same_as_last_time", same]);
    else {
      const why = excluded.find((e) => e.productId === lastId)?.reason ?? (input.candidates.some((p) => p.id === lastId) ? "no live offer" : "it does not meet this request's requirements");
      notes.push(`Same as last time (${primaryLine(input.last).name}) is not possible: ${why}.`);
    }
  }

  // Labelled plans first, then the next best by the goal, up to MAX_CARDS (a same-as-last-time card may make it one more).
  // When the buyer left a choice open, the best plan of each open value comes first and the labels go to those.
  const chosen: { plan: Plan; labels: OptionLabel[] }[] = [];
  if (input.span) {
    const seen = new Set<string | undefined>();
    // Values the buyer could have named first; a product whose value is unknown ("?") only fills a spare card.
    for (const pass of [false, true]) {
      for (const plan of ranked) {
        const key = input.span(plan.primary.p);
        if (Boolean(key?.includes("?")) !== pass || seen.has(key) || chosen.length >= MAX_CARDS) continue;
        seen.add(key);
        chosen.push({ plan, labels: [] });
      }
    }
    const among = (l: OptionLabel, plan: Plan | undefined) => plan && chosen.find((c) => c.plan === plan)?.labels.push(l);
    const inChosen = (xs: Plan[]) => xs.filter((pl) => chosen.some((c) => c.plan === pl));
    among("best_price", inChosen(byPrice)[0]);
    among("lowest_carbon", inChosen(withCo2).sort((a, b) => m(a).co2! - m(b).co2!)[0]);
    among("most_reliable", inChosen(withRel).sort((a, b) => m(b).rel! - m(a).rel!)[0]);
    const same = picks.find(([l]) => l === "same_as_last_time")?.[1];
    if (same) {
      if (!chosen.some((c) => c.plan === same)) chosen.push({ plan: same, labels: [] });
      among("same_as_last_time", same);
    }
  }
  for (const [label, plan] of input.span ? [] : picks) {
    if (!plan) continue;
    const existing = chosen.find((c) => c.plan === plan);
    if (existing) existing.labels.push(label);
    else if (chosen.length < MAX_CARDS || label === "same_as_last_time") chosen.push({ plan, labels: [label] });
  }
  for (const plan of ranked) {
    if (chosen.length >= MAX_CARDS) break;
    if (!chosen.some((c) => c.plan === plan)) chosen.push({ plan, labels: [] });
  }
  chosen.sort((a, b) => ranked.indexOf(a.plan) - ranked.indexOf(b.plan));

  const cards = chosen.map(({ plan, labels }, i) => {
    const x = m(plan);
    const gu = givesUp(plan);
    const cutoffs = plan.lines.map((l) => l.orderBy).filter((c): c is string => !!c).sort();
    return {
      optionId: `opt_${i + 1}`,
      rank: RANKS[Math.min(i, RANKS.length - 1)],
      match: gu.length ? ("compromise" as const) : ("full" as const),
      givesUp: gu,
      labels,
      title: plan.split ? `${plan.primary.p.name} + ${plan.split.sub.p.name} (substitute)` : plan.primary.p.name,
      lines: plan.lines,
      totalCents: x.total,
      deliveryDate: x.deliveryDate,
      ...(cutoffs[0] ? { orderBy: cutoffs[0] } : {}),
      stockConfirmed: plan.lines.every((l) => l.stockKnown !== false),
      delivered: { amount: x.delivered, unit: amount.unit },
      leftover: { amount: r2(x.delivered - amount.amount), unit: amount.unit },
      co2: x.co2 === null ? { kg: null, basis: "missing" as const } : { kg: r2(x.co2), basis: "product_group_average" as const },
      reliability: x.rel,
      signOff: x.signOff,
      pros: [] as string[],
      cons: [] as string[],
      quoteLines: plan.lines.map((l) => ({ productId: l.productId, quantity: l.packs, ...(l.substituteFor ? { substituteFor: l.substituteFor } : {}) })),
      _plan: plan,
    };
  });
  for (const c of cards) explainCard(c, cards, input);
  return { cards: cards.map(({ _plan, ...c }) => (void _plan, c)), excluded, notes };
}

/** Same category and unit, and every material attribute (diet, fat, organic) of the original. */
export function likeForLike(original: Product, sub: Product): boolean {
  return original.category === sub.category && original.attributes.filter(isMaterialAttribute).every((a) => sub.attributes.includes(a));
}

function measure(pl: Plan, input: OptionsInput) {
  const total = pl.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const delivered = r2(pl.lines.reduce((s, l) => s + l.packs * l.packSize, 0));
  const byId = new Map<string, Product>([[pl.primary.p.id, pl.primary.p]]);
  if (pl.split) byId.set(pl.split.sub.p.id, pl.split.sub.p);
  const products = pl.lines.map((l) => byId.get(l.productId)!);
  const carbon = products.map(carbonOf);
  const rels = products.map((p) => (p.deliveryReliabilityKnown === false ? undefined : known(p.deliveryReliability)));
  const co2 = carbon.every((c) => c !== undefined) ? pl.lines.reduce((s, l, i) => s + l.packs * l.packSize * carbon[i]!, 0) : null;
  const rel = rels.every((r) => r !== undefined) ? pl.lines.reduce((s, l, i) => s + l.packs * l.packSize * rels[i]!, 0) / delivered : null;
  const signOff: string[] = [];
  const { mandate } = input;
  if (total > mandate.perOrderLimitCents) signOff.push(`Over the ${formatEur(mandate.perOrderLimitCents)} the agent may spend alone: a person must sign off.`);
  const substitutes = pl.lines.filter((l) => l.substituteFor);
  if (substitutes.length && mandate.substitution.rule === "needs_approval") signOff.push("Includes a substitute: the mandate requires a person to approve it.");
  if (substitutes.length && mandate.substitution.rule === "within_preferences") {
    const original = input.candidates.find((p) => p.id === substitutes[0].substituteFor);
    const subProduct = input.candidates.find((p) => p.id === substitutes[0].productId);
    if (original && subProduct && !likeForLike(original, subProduct)) signOff.push(`The substitute is not like for like with ${original.name}: a person must approve it.`);
  }
  const deliveryDate = pl.lines.map((l) => l.deliveryDate).sort().at(-1)!;
  return { total, delivered, co2, rel: rel === null ? null : r2(rel), signOff, deliveryDate };
}

type Card = OptionCard & { _plan: Plan };

function explainCard(c: Card, all: Card[], input: OptionsInput): void {
  const others = all.filter((x) => x !== c);
  const unit = input.amount.unit;
  const pct = (a: number, b: number) => Math.round((a / b - 1) * 1000) / 10;

  c.cons.push(...c.givesUp.map((g) => g.text));

  if (others.length) {
    const cheapestOther = Math.min(...others.map((x) => x.totalCents));
    const cheapest = Math.min(cheapestOther, c.totalCents);
    if (c.totalCents < cheapestOther) c.pros.push(`Cheapest: ${formatEur(cheapestOther - c.totalCents)} less than the next option.`);
    else if (c.totalCents > cheapest) c.cons.push(`${formatEur(c.totalCents - cheapest)} (${pct(c.totalCents, cheapest)} %) more than the cheapest option.`);
    else c.pros.push("Joint cheapest.");
  }

  if (c.co2.kg === null) c.cons.push("No carbon data for this product.");
  else {
    const rest = others.map((x) => x.co2.kg).filter((k): k is number => k !== null);
    const min = Math.min(c.co2.kg, ...rest);
    if (rest.length && c.co2.kg < Math.min(...rest)) c.pros.push(`Lowest carbon: ${r2(Math.min(...rest) - c.co2.kg)} kg CO2e less than the next option (product-group average).`);
    else if (c.co2.kg > min) c.cons.push(`${r2(c.co2.kg - min)} kg CO2e more than the lowest-carbon option (product-group average).`);
  }

  if (c.reliability === null) c.cons.push("No delivery-reliability data for this product.");
  else {
    const rest = others.map((x) => x.reliability).filter((r): r is number => r !== null);
    const max = Math.max(c.reliability, ...rest);
    const pctText = (r: number) => `${Math.round(r * 100)} %`;
    if (rest.length && c.reliability > Math.max(...rest)) c.pros.push(`Most reliable: ${pctText(c.reliability)} of past deliveries in full, against ${pctText(Math.max(...rest))} for the next.`);
    else if (max - c.reliability >= RELIABILITY_GAP) c.cons.push(`Delivery reliability ${pctText(c.reliability)}, against ${pctText(max)} for the most reliable option.`);
  }

  const packs = c.lines.reduce((s, l) => s + l.packs, 0);
  if (c.leftover.amount > 0) c.cons.push(`Packs of ${formatAmount(c.lines[0].packSize, unit)} round it up to ${formatAmount(c.delivered.amount, unit)}: ${formatAmount(c.leftover.amount, unit)} more than asked.`);
  else c.pros.push(`Exact amount: ${c.lines.map((l) => `${l.packs} x ${formatAmount(l.packSize, unit)}`).join(" + ")}.`);
  if (others.length) {
    const fewest = Math.min(...others.map((x) => x.lines.reduce((s, l) => s + l.packs, 0)));
    if (packs >= MANY_PACKS && fewest * 2 <= packs) c.cons.push(`${packs} separate packs to handle, against ${fewest} for another option.`);
  }

  const split = c._plan.split;
  if (split) c.cons.push(`Partial stock: only ${formatAmount(r2(split.have), unit)} of ${c._plan.primary.p.id} available, so ${formatAmount(r2(split.rest), unit)} comes from ${split.sub.p.id} as a substitute.`);
  if (c.lines.some((l) => l.estimated)) c.cons.push("Pack count rests on an estimate of the pack content that you confirmed.");
  if (!c.stockConfirmed) c.cons.push("Stock not confirmed: the wholesaler does not report a quantity for this product, only that it can deliver.");
  if (c.orderBy) {
    const hours = (Date.parse(c.orderBy.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) - input.now.getTime()) / 3600_000;
    if (Number.isFinite(hours) && hours >= 0 && hours <= CUTOFF_SOON_HOURS) c.cons.push(`Order by ${formatCutoff(c.orderBy)}: the cut-off for this date is close.`);
  }
  const replaced = c._plan.replaces;
  if (replaced && input.reference?.source === "usual") c.cons.push(`Instead of your usual ${input.reference.name}.`);

  if (others.length) {
    const earliest = [c, ...others].map((x) => x.deliveryDate).sort()[0];
    if (c.deliveryDate > earliest) {
      const days = Math.round((Date.parse(c.deliveryDate) - Date.parse(earliest)) / 86_400_000);
      c.cons.push(`Arrives ${formatDay(c.deliveryDate)}, ${days} day${days === 1 ? "" : "s"} after the earliest option.`);
    } else if (others.every((x) => x.deliveryDate > c.deliveryDate)) c.pros.push(`Arrives first: ${formatDay(c.deliveryDate)}.`);
  }

  c.cons.push(...c.signOff);
  if (c.labels.includes("same_as_last_time") && input.last) c.pros.push(`Same product as your last order (${formatDay(input.last.placedAt.slice(0, 10))}).`);
  if (input.usual && c._plan.primary.p.id === input.usual.productId) c.pros.push(`Your usual product (${input.usual.text.replace(/^Usually [^:]*: /, "")}).`);
}

/** Which card to pre-select for a goal. A goal with a tolerance ("lowest CO2 if within 5 % of the cheapest") falls back to the cheapest. */
export function preselect(cards: OptionCard[], goal: OptimiseGoal | undefined, withinPctOfCheapest?: number): { optionId: string; reason: string } | undefined {
  const by = (l: OptionLabel) => cards.find((c) => c.labels.includes(l));
  const cheapest = by("best_price");
  if (goal === "price" && cheapest) return { optionId: cheapest.optionId, reason: "Lowest price, as asked." };
  if (goal === "reliability") {
    const c = by("most_reliable");
    return c ? { optionId: c.optionId, reason: "Most reliable delivery, as asked." } : undefined;
  }
  if (goal === "co2") {
    const c = by("lowest_carbon");
    if (!c) return undefined;
    if (withinPctOfCheapest === undefined || !cheapest || c.totalCents <= cheapest.totalCents * (1 + withinPctOfCheapest / 100)) {
      return { optionId: c.optionId, reason: withinPctOfCheapest === undefined ? "Lowest CO2, as asked." : `Lowest CO2, and within ${withinPctOfCheapest} % of the cheapest.` };
    }
    return { optionId: cheapest.optionId, reason: `The lowest-CO2 option costs more than ${withinPctOfCheapest} % over the cheapest, so the cheapest is pre-selected.` };
  }
  return undefined;
}
