import type { LiveOffer, Product } from "./catalog";
import { formatDay, primaryLine, type HistoryEntry } from "./kitchen";
import type { Mandate } from "./mandate";
import { formatAmount, type BaseUnit, type OptimiseGoal } from "./need";
import type { QuoteRequestLine } from "./quote";
import { addDays, formatEur, isoDate } from "./util";

/**
 * Option cards: up to three labelled ways to fill a need (best price, lowest carbon, most reliable), plus
 * "same as last time" when the kitchen has one. Every figure comes from master data or the live offer;
 * pros and cons are templates comparing the cards with each other. Cards already respect the hard
 * constraints (the caller filters products) and what the mandate checks: delivery deadline, substitution
 * rule and price tolerance, and the weekly budget. A card over the per-order limit is kept and says it
 * needs a sign-off.
 */

export type OptionLabel = "best_price" | "lowest_carbon" | "most_reliable" | "same_as_last_time";
export const LABEL_TEXT: Record<OptionLabel, string> = {
  best_price: "Best price",
  lowest_carbon: "Lowest carbon",
  most_reliable: "Most reliable delivery",
  same_as_last_time: "Same as last time",
};
const LABEL_ORDER: OptionLabel[] = ["best_price", "lowest_carbon", "most_reliable", "same_as_last_time"];

export type PlanLine = {
  productId: string;
  name: string;
  packs: number;
  packSize: number;
  unit: BaseUnit;
  unitPriceCents: number; // per pack
  lineTotalCents: number;
  deliveryDate: string;
  substituteFor?: string;
};

export type OptionCard = {
  optionId: string;
  labels: OptionLabel[];
  title: string;
  lines: PlanLine[];
  totalCents: number;
  deliveryDate: string;
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

export type OptionsInput = {
  amount: { amount: number; unit: BaseUnit };
  candidates: Product[];
  offers: LiveOffer[];
  mandate: Mandate;
  now: Date;
  neededBy?: string;
  spentThisWeekCents: number;
  last?: HistoryEntry;
  usual?: { productId: string; text: string }; // learned usual product, for a "your usual" pro
};

export type OptionsResult = { cards: OptionCard[]; excluded: { productId: string; reason: string }[]; notes: string[] };

// ---------- thresholds ----------

/** Reliability gaps below 2 points are within the noise of the partner's history file. */
export const RELIABILITY_GAP = 0.02;
/** From this many packs, handling effort is worth a mention when another option needs half as many. */
export const MANY_PACKS = 40;

/** Read a figure that may be missing in real data (only a quarter of products have a reliability value). */
export function known(n: number | null | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

type Plan = { primary: Product; lines: PlanLine[]; split?: { have: number; rest: number; sub: Product } };

const perUnit = (o: LiveOffer, p: Product) => o.unitPriceCents / p.packSize;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Products worth a live price call: the last and usual products first, then the most reliable and lowest-carbon ones. */
export function shortlist(candidates: Product[], prefer: (string | undefined)[], max: number): Product[] {
  if (candidates.length <= max) return candidates;
  const byRel = [...candidates].sort((a, b) => (known(b.deliveryReliability) ?? -1) - (known(a.deliveryReliability) ?? -1) || a.id.localeCompare(b.id));
  const byCo2 = [...candidates].sort((a, b) => (known(a.carbonKgPerUnit) ?? Infinity) - (known(b.carbonKgPerUnit) ?? Infinity) || a.id.localeCompare(b.id));
  const ids: string[] = prefer.filter((x): x is string => !!x && candidates.some((p) => p.id === x));
  for (let i = 0; ids.length < max && i < candidates.length; i++) {
    for (const p of [byRel[i], byCo2[i]]) if (!ids.includes(p.id) && ids.length < max) ids.push(p.id);
  }
  return ids.map((id) => candidates.find((p) => p.id === id)!);
}

export function buildOptions(input: OptionsInput): OptionsResult {
  const { amount, mandate } = input;
  const excluded: OptionsResult["excluded"] = [];
  const notes: string[] = [];
  const leadLimit = isoDate(addDays(input.now, mandate.delivery.maxLeadDays));
  const latest = input.neededBy && input.neededBy < leadLimit ? input.neededBy : leadLimit;
  const offerOf = new Map(input.offers.map((o) => [o.productId, o]));

  const viable: Product[] = [];
  for (const p of input.candidates) {
    const o = offerOf.get(p.id);
    if (!o) excluded.push({ productId: p.id, reason: "no live offer right now" });
    else if (p.unit !== amount.unit) excluded.push({ productId: p.id, reason: `sold by ${p.unit}, not ${amount.unit}` });
    else if (o.availablePacks <= 0) excluded.push({ productId: p.id, reason: "out of stock" });
    else if (o.deliveryDate > latest) excluded.push({ productId: p.id, reason: `earliest delivery ${o.deliveryDate} is after ${latest}` });
    else viable.push(p);
  }

  const line = (p: Product, packs: number, substituteFor?: string): PlanLine => {
    const o = offerOf.get(p.id)!;
    return { productId: p.id, name: p.name, packs, packSize: p.packSize, unit: p.unit, unitPriceCents: o.unitPriceCents, lineTotalCents: packs * o.unitPriceCents, deliveryDate: o.deliveryDate, substituteFor };
  };
  const packsFor = (p: Product, units: number) => Math.ceil(units / p.packSize - 1e-9);

  const plans: Plan[] = [];
  for (const p of viable) {
    const o = offerOf.get(p.id)!;
    const need = packsFor(p, amount.amount);
    if (o.availablePacks >= need) {
      plans.push({ primary: p, lines: [line(p, need)] });
      continue;
    }
    const have = o.availablePacks * p.packSize;
    const rest = amount.amount - have;
    const stockNote = `only ${formatAmount(have, p.unit)} in stock`;
    if (mandate.substitution.rule === "none") {
      excluded.push({ productId: p.id, reason: `${stockNote}, and the mandate allows no substitutes` });
      continue;
    }
    const sub = viable
      .filter((q) => q.id !== p.id && offerOf.get(q.id)!.availablePacks * q.packSize >= rest)
      .filter((q) => mandate.substitution.rule !== "same_attributes" || (q.category === p.category && p.attributes.every((a) => q.attributes.includes(a))))
      .filter((q) => (perUnit(offerOf.get(q.id)!, q) / perUnit(o, p) - 1) * 100 <= mandate.substitution.maxPriceIncreasePct + 1e-9)
      .sort((a, b) => perUnit(offerOf.get(a.id)!, a) - perUnit(offerOf.get(b.id)!, b) || a.id.localeCompare(b.id))[0];
    if (!sub) {
      excluded.push({ productId: p.id, reason: `${stockNote}, and no substitute within the mandate covers the rest` });
      continue;
    }
    plans.push({ primary: p, lines: [line(p, o.availablePacks), line(sub, packsFor(sub, rest), p.id)], split: { have, rest, sub } });
  }

  const total = (pl: Plan) => pl.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const affordable = plans.filter((pl) => {
    const over = input.spentThisWeekCents + total(pl) > mandate.weeklyBudgetCents;
    if (over) excluded.push({ productId: pl.primary.id, reason: `${formatEur(total(pl))} would go over the weekly budget (${formatEur(mandate.weeklyBudgetCents - input.spentThisWeekCents)} left)` });
    return !over;
  });

  const metrics = new Map(affordable.map((pl) => [pl, measure(pl, input)]));
  const m = (pl: Plan) => metrics.get(pl)!;
  const byPrice = [...affordable].sort((a, b) => m(a).total - m(b).total || (m(a).co2 ?? Infinity) - (m(b).co2 ?? Infinity) || (m(b).rel ?? -1) - (m(a).rel ?? -1) || a.primary.id.localeCompare(b.primary.id));
  const withCo2 = byPrice.filter((pl) => m(pl).co2 !== null);
  const withRel = byPrice.filter((pl) => m(pl).rel !== null);
  const picks: [OptionLabel, Plan | undefined][] = [
    ["best_price", byPrice[0]],
    ["lowest_carbon", [...withCo2].sort((a, b) => m(a).co2! - m(b).co2!)[0]], // stable sort: ties go to the cheaper
    ["most_reliable", [...withRel].sort((a, b) => m(b).rel! - m(a).rel!)[0]],
  ];
  if (affordable.length && !withCo2.length) notes.push("No carbon data for any of these products, so there is no lowest-carbon option.");
  if (affordable.length && !withRel.length) notes.push("No delivery-reliability data for any of these products, so there is no most-reliable option.");
  if (input.last) {
    const lastId = primaryLine(input.last).productId;
    const same = affordable.find((pl) => pl.primary.id === lastId);
    if (same) picks.push(["same_as_last_time", same]);
    else {
      const why = excluded.find((e) => e.productId === lastId)?.reason ?? (input.candidates.some((p) => p.id === lastId) ? "no live offer" : "it does not meet this request's requirements");
      notes.push(`Same as last time (${primaryLine(input.last).name}) is not possible: ${why}.`);
    }
  }

  // One card per plan, carrying every label that picked it.
  const chosen: { plan: Plan; labels: OptionLabel[] }[] = [];
  for (const [label, plan] of picks) {
    if (!plan) continue;
    const existing = chosen.find((c) => c.plan === plan);
    if (existing) existing.labels.push(label);
    else chosen.push({ plan, labels: [label] });
  }
  chosen.sort((a, b) => LABEL_ORDER.indexOf(a.labels[0]) - LABEL_ORDER.indexOf(b.labels[0]));

  const cards = chosen.map(({ plan, labels }, i) => {
    const x = m(plan);
    return {
      optionId: `opt_${i + 1}`,
      labels,
      title: plan.split ? `${plan.primary.name} + ${plan.split.sub.name} (substitute)` : plan.primary.name,
      lines: plan.lines,
      totalCents: x.total,
      deliveryDate: x.deliveryDate,
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

function measure(pl: Plan, input: OptionsInput) {
  const total = pl.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const delivered = r2(pl.lines.reduce((s, l) => s + l.packs * l.packSize, 0));
  const product = (id: string) => (id === pl.primary.id ? pl.primary : pl.split!.sub);
  const carbon = pl.lines.map((l) => known(product(l.productId).carbonKgPerUnit));
  const rels = pl.lines.map((l) => known(product(l.productId).deliveryReliability));
  const co2 = carbon.every((c) => c !== undefined) ? pl.lines.reduce((s, l, i) => s + l.packs * l.packSize * carbon[i]!, 0) : null;
  const rel = rels.every((r) => r !== undefined) ? pl.lines.reduce((s, l, i) => s + l.packs * l.packSize * rels[i]!, 0) / delivered : null;
  const signOff: string[] = [];
  if (total > input.mandate.perOrderLimitCents) signOff.push(`Over the ${formatEur(input.mandate.perOrderLimitCents)} the agent may spend alone: a person must sign off.`);
  if (pl.split && input.mandate.substitution.rule === "needs_approval") signOff.push("Includes a substitute: the mandate requires a person to approve it.");
  const deliveryDate = pl.lines.map((l) => l.deliveryDate).sort().at(-1)!;
  return { total, delivered, co2, rel: rel === null ? null : r2(rel), signOff, deliveryDate };
}

type Card = OptionCard & { _plan: Plan };

function explainCard(c: Card, all: Card[], input: OptionsInput): void {
  const others = all.filter((x) => x !== c);
  const unit = input.amount.unit;
  const pct = (a: number, b: number) => Math.round((a / b - 1) * 1000) / 10;

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
  const fewest = Math.min(...others.map((x) => x.lines.reduce((s, l) => s + l.packs, 0)));
  if (packs >= MANY_PACKS && fewest * 2 <= packs) c.cons.push(`${packs} separate packs to handle, against ${fewest} for another option.`);

  const split = c._plan.split;
  if (split) c.cons.push(`Partial stock: only ${formatAmount(split.have, unit)} of ${c._plan.primary.id} available, so ${formatAmount(r2(split.rest), unit)} comes from ${split.sub.id} as a substitute.`);

  if (others.length) {
    const earliest = [c, ...others].map((x) => x.deliveryDate).sort()[0];
    if (c.deliveryDate > earliest) {
      const days = Math.round((Date.parse(c.deliveryDate) - Date.parse(earliest)) / 86_400_000);
      c.cons.push(`Arrives ${formatDay(c.deliveryDate)}, ${days} day${days === 1 ? "" : "s"} after the earliest option.`);
    } else if (others.every((x) => x.deliveryDate > c.deliveryDate)) c.pros.push(`Arrives first: ${formatDay(c.deliveryDate)}.`);
  }

  c.cons.push(...c.signOff);
  if (c.labels.includes("same_as_last_time") && input.last) c.pros.push(`Same product as your last order (${formatDay(input.last.placedAt.slice(0, 10))}).`);
  if (input.usual && c._plan.primary.id === input.usual.productId) c.pros.push(`Your usual product (${input.usual.text.replace(/^Usually [^:]*: /, "")}).`);
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
