import type { LiveOffer, Product } from "./catalog";
import type { MatchLabel } from "./catalog/finder";
import { addDaysIso, isoWeekday, primaryLine, type HistoryEntry, type KitchenProfile, type StatedPreference } from "./kitchen";
import type { Mandate } from "./mandate";
import type { BaseUnit } from "./need";
import { compareNutrition, comparisonText, type NutritionComparison } from "./nutrition";
import { isMaterialAttribute } from "./vocabulary";

/**
 * The kitchen agent's watch, as plain code (no model, ever): what it learns from a kitchen's own orders, when a
 * recurring order has drifted, whether to renew it or hold it, and how to rank substitutes for a product that cannot
 * come. The server (server/watch) feeds it records and live answers; everything here is a pure function of them.
 *
 *   learnPatterns    the weekly pattern per product family: weekday(s), usual amount and unit price, and the
 *                    orders and weeks it rests on
 *   trendOf          a trend over several weeks (least squares over the trailing points, the longest window that
 *                    holds), not only last-versus-usual
 *   driftOf          portions creeping (amount trend), cost drifting (unit-price trend), the same basket costing more
 *                    at today's live price
 *   decideRenewal    renew alone, hold and ask (renew at the new amount, back to the usual, skip this week), only
 *                    remind, or nothing
 *   rankSubstitutes  good, better, best, each with its trade-off in figures, and whether it is inside the kitchen's
 *                    stated preferences (insidePreferences): only those the agent may order alone
 */

export const PATTERN_MIN_ORDERS = 3;
export const TREND_MIN_POINTS = 4;
export const TREND_MAX_POINTS = 8;
export const TREND_MIN_R2 = 0.7;
/** Portions: a trend of at least this many percent over its window. */
export const AMOUNT_TREND_PCT = 10;
/** Cost: a unit-price trend of at least this many percent. */
export const PRICE_TREND_PCT = 5;
/** The same basket at today's live price, against the usual unit price. */
export const BASKET_DRIFT_PCT = 5;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** The Monday of a date's ISO week. */
export const weekOf = (date: string) => addDaysIso(date, 1 - isoWeekday(date));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

// ---------- the pattern ----------

/** One past order of the family, as the pattern sees it. `staged`: written by staff for a demo, never a real order. */
export type Point = { date: string; orderId: string; amount: number; perUnitCents: number | null; totalCents: number; productId: string; staged?: boolean };

/** One weekday the kitchen orders the family for. */
export type Slot = { weekday: number; orders: number; usualAmount: number; usualPerUnitCents: number | null; points: Point[] };

export type Pattern = {
  family: string;
  unit: BaseUnit;
  /** The product it usually buys (the most frequent main line of its last eight orders). */
  product: { productId: string; name: string; packSize: number; unit: BaseUnit; attributes: string[]; unitPriceCents: number };
  slots: Slot[];
  /** Per order, median over every order of the family. */
  usualAmount: number;
  usualPerUnitCents: number | null;
  /** The weeks and orders it rests on. */
  basedOn: { orders: number; weeks: string[]; from: string; to: string };
  stagedPoints: number;
};

const dayOf = (h: HistoryEntry) => h.neededBy ?? h.deliveryDate;

/**
 * The weekly pattern per product family, learned from the kitchen's own orders (its history, which holds every
 * order it committed). A family needs PATTERN_MIN_ORDERS orders over at least two weeks; a weekday is part of the
 * pattern when at least a quarter of the orders were for it. Orders for a site of the kitchen are left out (another
 * pattern). `staged(orderId)` marks orders staff staged for a demo.
 */
export function learnPatterns(profile: KitchenProfile | undefined, opts: { staged?: (orderId: string) => boolean; paused?: string[] } = {}): Pattern[] {
  if (!profile) return [];
  const out: Pattern[] = [];
  for (const family of [...new Set(profile.history.map((h) => h.family))]) {
    const all = profile.history.filter((h) => h.family === family && !h.site).sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.placedAt.localeCompare(b.placedAt));
    if (!all.length) continue;
    const unit = all.at(-1)!.unit;
    const hist = all.filter((h) => h.unit === unit && h.amount > 0);
    const weeks = [...new Set(hist.map((h) => weekOf(dayOf(h))))].sort();
    if (hist.length < PATTERN_MIN_ORDERS || weeks.length < 2) continue;
    const point = (h: HistoryEntry): Point => ({ date: dayOf(h), orderId: h.orderId, amount: h.amount, perUnitCents: unit === "pcs" ? null : r1(h.totalCents / h.amount), totalCents: h.totalCents, productId: primaryLine(h).productId, ...(opts.staged?.(h.orderId) ? { staged: true } : {}) });
    const points = hist.map(point);
    const counts = new Map<number, number>();
    for (const p of points) counts.set(isoWeekday(p.date), (counts.get(isoWeekday(p.date)) ?? 0) + 1);
    const slots: Slot[] = [...counts.entries()]
      .filter(([, n]) => n / points.length >= 0.25)
      .map(([weekday]) => {
        const ps = points.filter((p) => isoWeekday(p.date) === weekday);
        return { weekday, orders: ps.length, usualAmount: median(ps.map((p) => p.amount))!, usualPerUnitCents: median(ps.flatMap((p) => (p.perUnitCents === null ? [] : [p.perUnitCents]))), points: ps };
      })
      .sort((a, b) => a.weekday - b.weekday);
    if (!slots.length) continue;
    // The product it usually buys: the most frequent main product of its last eight orders (a sell-out week's
    // other product does not become the usual), the latest on a tie.
    const recent = hist.slice(-8).map((h) => primaryLine(h));
    const freq = new Map<string, number>();
    for (const l of recent) freq.set(l.productId, (freq.get(l.productId) ?? 0) + 1);
    const top = Math.max(...freq.values());
    const main = [...recent].reverse().find((l) => freq.get(l.productId) === top)!;
    out.push({
      family,
      unit,
      product: { productId: main.productId, name: main.name, packSize: main.packSize, unit: main.unit, attributes: main.attributes, unitPriceCents: main.unitPriceCents },
      slots,
      usualAmount: median(points.map((p) => p.amount))!,
      usualPerUnitCents: median(points.flatMap((p) => (p.perUnitCents === null ? [] : [p.perUnitCents]))),
      basedOn: { orders: points.length, weeks, from: points[0].date, to: points.at(-1)!.date },
      stagedPoints: points.filter((p) => p.staged).length,
    });
  }
  return out.sort((a, b) => b.basedOn.orders - a.basedOn.orders);
}

/** The next day (after `today`, within a week) one of the pattern's weekdays falls on, and its slot. */
export function nextSlot(p: Pattern, today: string, opts: { includeToday?: boolean } = {}): { date: string; slot: Slot } | undefined {
  for (let i = opts.includeToday ? 0 : 1; i <= 7; i++) {
    const d = addDaysIso(today, i);
    const slot = p.slots.find((s) => s.weekday === isoWeekday(d));
    if (slot) return { date: d, slot };
  }
  return undefined;
}

// ---------- trends ----------

export type TrendFit = { start: number; from: number; to: number; pct: number; slopePerWeek: number; r2: number; points: number };

/**
 * A trend over the trailing points: least squares (x in weeks) over the longest trailing window of TREND_MIN_POINTS
 * to TREND_MAX_POINTS points where the fit explains at least TREND_MIN_R2 of the variance, the fitted change over the
 * window is at least `minPct`, every point moves the same way as the one before, and the last point really is that
 * far from the window's first. So 80, 90, 100, 110 is a trend; 100, 90, 110, 100 and 110, 100, 100, 90 are noise.
 */
export function trendOf(values: { date: string; value: number }[], minPct: number): TrendFit | undefined {
  const n = values.length;
  for (let k = Math.min(TREND_MAX_POINTS, n); k >= TREND_MIN_POINTS; k--) {
    const w = values.slice(n - k);
    const xs = w.map((v) => daysBetween(w[0].date, v.date) / 7);
    const ys = w.map((v) => v.value);
    const mx = xs.reduce((s, x) => s + x, 0) / k;
    const my = ys.reduce((s, y) => s + y, 0) / k;
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const syy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
    if (sxx === 0 || syy === 0) continue;
    const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const b = sxy / sxx;
    const a = my - b * mx;
    const r2v = (sxy * sxy) / (sxx * syy);
    const fitFirst = a + b * xs[0];
    const fitLast = a + b * xs[k - 1];
    if (fitFirst <= 0) continue;
    const pct = ((fitLast - fitFirst) / fitFirst) * 100;
    const actual = ((ys[k - 1] - ys[0]) / ys[0]) * 100;
    // Every week moves the same way: three moves in a row, not a dip between two ordinary weeks.
    const steady = ys.slice(1).every((y, i) => Math.sign(y - ys[i]) === Math.sign(actual) && y !== ys[i]);
    if (!steady || r2v < TREND_MIN_R2 || Math.abs(pct) < minPct || Math.abs(actual) < minPct || Math.sign(actual) !== Math.sign(pct)) continue;
    return { start: n - k, from: ys[0], to: ys[k - 1], pct: r1(actual), slopePerWeek: r2(b), r2: r2(r2v), points: k };
  }
  return undefined;
}

export type Trend = {
  kind: "portions" | "cost";
  direction: "up" | "down";
  /** The first and last value of the window: litres or kilos per order (portions), cents per litre or kilo (cost). */
  from: number;
  to: number;
  pct: number;
  /** The first order of the window. */
  since: string;
  weeks: number;
  perWeek: number;
  r2: number;
  points: Point[];
  staged: boolean;
};

export type BasketDrift = { amount: number; unit: BaseUnit; usualPerUnitCents: number; nowPerUnitCents: number; usualCents: number; nowCents: number; pct: number; since: string; staged: boolean };

export type Drift = { portions?: Trend; cost?: Trend; basket?: BasketDrift };

export const drifted = (d: Drift) => !!(d.portions || d.cost || d.basket);

function trend(kind: Trend["kind"], points: Point[], value: (p: Point) => number | null, minPct: number): Trend | undefined {
  const usable = points.filter((p) => value(p) !== null);
  const fit = trendOf(usable.map((p) => ({ date: p.date, value: value(p)! })), minPct);
  if (!fit) return undefined;
  const w = usable.slice(fit.start);
  return { kind, direction: fit.pct > 0 ? "up" : "down", from: fit.from, to: fit.to, pct: fit.pct, since: w[0].date, weeks: Math.max(1, Math.round(daysBetween(w[0].date, w.at(-1)!.date) / 7)), perWeek: fit.slopePerWeek, r2: fit.r2, points: w, staged: w.some((p) => p.staged) };
}

/**
 * How the slot's recurring order has drifted: portions (the slot's amounts), cost (unit prices over every order of
 * the family, any weekday) and, with today's live price per litre or kilo, the same basket against the usual price.
 */
export function driftOf(p: Pattern, slot: Slot, now?: { perUnitCents: number | null; staged?: boolean }): Drift {
  const out: Drift = {};
  const portions = trend("portions", slot.points, (x) => x.amount, AMOUNT_TREND_PCT);
  if (portions) out.portions = portions;
  const all = p.slots.flatMap((s) => s.points).sort((a, b) => a.date.localeCompare(b.date));
  const cost = trend("cost", all, (x) => x.perUnitCents, PRICE_TREND_PCT);
  if (cost) out.cost = cost;
  const base = renewalAmounts(slot, out).usual;
  if (now?.perUnitCents && slot.usualPerUnitCents && !cost) {
    // The usual price: what the kitchen paid before any cost trend; the basket: the usual amount at both prices.
    const usual = slot.usualPerUnitCents;
    const pct = ((now.perUnitCents - usual) / usual) * 100;
    if (Math.abs(pct) >= BASKET_DRIFT_PCT) {
      out.basket = { amount: base, unit: p.unit, usualPerUnitCents: usual, nowPerUnitCents: now.perUnitCents, usualCents: Math.round(base * usual), nowCents: Math.round(base * now.perUnitCents), pct: r1(pct), since: slot.points.at(-1)!.date, staged: !!now.staged };
    }
  }
  return out;
}

/** The amounts a held renewal can be renewed at: the usual (before any trend) and the new level (the trend's last). */
export function renewalAmounts(slot: Slot, drift: Drift): { usual: number; latest: number } {
  const t = drift.portions;
  const before = t ? slot.points.filter((p) => p.date < t.since).map((p) => p.amount) : [];
  return { usual: (t ? median(before.length ? before : [t.from]) : null) ?? slot.usualAmount, latest: t ? t.to : (slot.points.at(-1)?.amount ?? slot.usualAmount) };
}

// ---------- renew or hold ----------

export type RenewalChoice = "renew_new" | "usual" | "skip";
export type RenewalDecision =
  | { action: "place"; reason: string }
  | { action: "hold"; reason: string; because: ("portions" | "cost" | "basket" | "stock")[]; choices: RenewalChoice[] }
  | { action: "remind"; reason: string }
  | { action: "none"; reason: string };

export type RenewalInput = {
  /** The kitchen switched auto-renew on for this family (recorded with who). Off by default. */
  autoRenew: boolean;
  paused: boolean;
  drift: Drift;
  /** Can the usual product come for the day: true, false (a watch finding), or unknown (the live service did not answer). */
  available: boolean | undefined;
  /** An order (or a renewal) for this family and day exists already. */
  handled: boolean;
  /** The order cut-off for the day has passed. */
  cutoffPassed: boolean;
};

/**
 * Renew or hold, in plain code. Nothing when paused, already handled, or past the cut-off; only a reminder when
 * auto-renew is off; hold and ask when anything drifted or the product cannot come; else place it alone (the gate
 * still decides: anything above the mandate goes to sign-off).
 */
export function decideRenewal(i: RenewalInput): RenewalDecision {
  if (i.paused) return { action: "none", reason: "The kitchen paused this recurring order." };
  if (i.handled) return { action: "none", reason: "There is an order for this day already." };
  if (i.cutoffPassed) return { action: "none", reason: "The order cut-off for this day has passed." };
  if (!i.autoRenew) return { action: "remind", reason: "Auto-renew is off: the kitchen orders it itself." };
  const because: ("portions" | "cost" | "basket" | "stock")[] = [];
  if (i.drift.portions) because.push("portions");
  if (i.drift.cost) because.push("cost");
  if (i.drift.basket) because.push("basket");
  if (i.available === false) because.push("stock");
  if (i.available === undefined) return { action: "hold", reason: "The wholesaler's live service did not answer: nothing is renewed without a live price.", because: [], choices: ["usual", "skip"] };
  if (because.length) {
    const choices: RenewalChoice[] = i.drift.portions ? ["renew_new", "usual", "skip"] : ["usual", "skip"];
    return { action: "hold", reason: `Held before renewing: ${because.map((b) => ({ portions: "the amount has been creeping", cost: "the unit price has been drifting", basket: "the same order costs more at today's price", stock: "the usual product cannot come for the day" })[b]).join("; ")}.`, because, choices };
  }
  return { action: "place", reason: "Nothing drifted and the usual product can come: renewed as usual, through the gate." };
}

// ---------- substitutes ----------

export type SubstituteCandidate = {
  product: Product;
  /** How the search labelled it against what the kitchen buys (exact, variant, stand-in); absent when no judge answered. */
  label?: MatchLabel;
  /** The knowledge map's tier and reason, when it proposed it. */
  map?: { tier: "best" | "better" | "good"; reason: string; sameKind: boolean; conditions: string[] };
  /** The usable live offer for it, if any (price per pack, earliest delivery). */
  offer?: LiveOffer;
};

export type TradeOff = {
  perUnitCents: number | null;
  usualPerUnitCents: number | null;
  /** Per litre or kilo, against the usual (positive: dearer). */
  perUnitDiffCents: number | null;
  perUnitDiffPct: number | null;
  packSize: number;
  unit: string;
  packs: number;
  packCents: number | null;
  totalCents: number | null;
  /** What `packs` packs hold, against the amount needed. */
  delivered: number;
  sameMaker: boolean;
  maker: string | null;
  usualMaker: string | null;
  allergensAdded: string[];
  allergensRemoved: string[];
  allergenDataMissing: boolean;
  claimsLost: string[];
  claimsGained: string[];
  fat: { from: string | null; to: string | null } | null;
  /** The maker's nutrition declarations compared (core/nutrition.ts): per 100 g or ml, unknown said as unknown. */
  nutrition?: NutritionComparison;
  nutritionText?: string;
  /** The wholesaler's own product file lists it as a substitute for the original. */
  wholesalerLists: boolean;
  reliability: { pct: number; usualPct: number } | null;
  carbon: { kgPerUnit: number; usualKgPerUnit: number } | null;
  deliveryDate: string | null;
  onTime: boolean;
};

export type RankedSubstitute = {
  rank: "best" | "better" | "good";
  productId: string;
  name: string;
  label?: MatchLabel;
  mapTier?: "best" | "better" | "good";
  insidePreferences: boolean;
  /** Why it is outside the kitchen's stated preferences (empty when inside). */
  outside: string[];
  tradeOff: TradeOff;
  /** One factual line, from the figures. */
  why: string;
};

const fatOf = (attrs: string[]) => attrs.find((a) => /^fat_\d/.test(a)) ?? null;
const fatText = (a: string | null) => (a ? `${a.slice(4).replace("_", ",")} %` : "unknown");
const perUnit = (p: Product, packCents: number) => (p.unit === "pcs" ? null : r1(packCents / p.packSize));
const declaredAllergens = (p: Product) => p.allergenInfo?.declared !== false;

function nutritionOf(original: Product, p: Product): { nutrition?: NutritionComparison; nutritionText?: string } {
  const cmp = original.nutrition ? compareNutrition(original.nutrition, p.nutrition) : undefined;
  const text = comparisonText(cmp);
  return { ...(cmp ? { nutrition: cmp } : {}), ...(text ? { nutritionText: text } : {}) };
}

/** The figures of a substitute against the product it replaces, for `amount` of the base unit by `date`. */
export function tradeOffOf(original: Product, usualPerUnitCents: number | null, c: SubstituteCandidate, need: { amount: number; date: string }): TradeOff {
  const o = c.offer;
  const p = c.product;
  const packs = Math.max(1, Math.ceil(need.amount / p.packSize - 1e-9));
  const unitCents = o ? perUnit(p, o.unitPriceCents) : null;
  const diff = unitCents !== null && usualPerUnitCents ? r1(unitCents - usualPerUnitCents) : null;
  const omat = original.attributes.filter(isMaterialAttribute);
  const pmat = p.attributes.filter(isMaterialAttribute);
  const fo = fatOf(original.attributes);
  const fp = fatOf(p.attributes);
  const known = (x: Product) => x.deliveryReliabilityKnown !== false && x.deliveryReliability > 0;
  const carbonKnown = (x: Product) => x.carbonKnown !== false && x.carbonKgPerUnit > 0;
  return {
    perUnitCents: unitCents,
    usualPerUnitCents,
    perUnitDiffCents: diff,
    perUnitDiffPct: diff !== null && usualPerUnitCents ? r1((diff / usualPerUnitCents) * 100) : null,
    packSize: p.packSize,
    unit: p.unit,
    packs,
    packCents: o?.unitPriceCents ?? null,
    totalCents: o ? packs * o.unitPriceCents : null,
    delivered: r2(packs * p.packSize),
    sameMaker: !!p.brand && p.brand !== "unknown" && p.brand === original.brand,
    maker: p.brand && p.brand !== "unknown" ? p.brand : null,
    usualMaker: original.brand && original.brand !== "unknown" ? original.brand : null,
    allergensAdded: p.allergens.filter((a) => !original.allergens.includes(a)),
    allergensRemoved: original.allergens.filter((a) => !p.allergens.includes(a)),
    allergenDataMissing: !declaredAllergens(p),
    claimsLost: omat.filter((a) => !pmat.includes(a) && !/^fat_/.test(a)),
    claimsGained: pmat.filter((a) => !omat.includes(a) && !/^fat_/.test(a)),
    fat: fo !== fp ? { from: fo, to: fp } : null,
    ...nutritionOf(original, p),
    wholesalerLists: !!original.substitutes?.includes(p.id),
    reliability: known(p) && known(original) ? { pct: r1(p.deliveryReliability * 100), usualPct: r1(original.deliveryReliability * 100) } : null,
    carbon: carbonKnown(p) && carbonKnown(original) ? { kgPerUnit: r2(p.carbonKgPerUnit), usualKgPerUnit: r2(original.carbonKgPerUnit) } : null,
    deliveryDate: o?.deliveryDate ?? null,
    onTime: !!o && o.deliveryDate <= need.date,
  };
}

/**
 * Inside the kitchen's stated preferences: the agent may order it alone. Same kind (same family and unit, every
 * material attribute of the original, not a stand-in of another kind), the same allergen profile (no allergen the
 * original does not have, and declared allergen data), and within the mandate (its product groups, required claims,
 * labels, forbidden allergens, a substitution rule that lets the agent choose like for like, and at most its price
 * increase per litre or kilo) and the rules the kitchen's people stated. Anything else needs a person's sign-off.
 */
export function insidePreferences(original: Product, c: SubstituteCandidate, t: TradeOff, mandate: Pick<Mandate, "allowedCategories" | "requiredAttributes" | "forbiddenAllergens" | "requiredCertificates" | "substitution">, stated: StatedPreference[] = []): { inside: boolean; outside: string[] } {
  const p = c.product;
  const why: string[] = [];
  if (p.category !== original.category || p.unit !== original.unit) why.push(`another kind of product (${p.category.replaceAll("_", " ")})`);
  else if (c.label === "standin" || c.label === "other" || (c.map && !c.map.sameKind)) why.push("a stand-in of another kind, not the same product kind");
  const lost = original.attributes.filter(isMaterialAttribute).filter((a) => !p.attributes.includes(a));
  if (lost.length) why.push(`not ${lost.map((a) => a.replaceAll("_", " ")).join(", ")} like the usual`);
  if (t.allergenDataMissing) why.push("no declared allergen data");
  else if (t.allergensAdded.length) why.push(`contains ${t.allergensAdded.join(", ")}, which the usual does not`);
  if (!mandate.allowedCategories.includes(p.category)) why.push(`${p.category.replaceAll("_", " ")} is not in the kitchen's signed product groups`);
  const missing = mandate.requiredAttributes.filter((a) => !p.attributes.includes(a));
  if (missing.length) why.push(`the mandate requires ${missing.join(", ")}`);
  const forbidden = p.allergens.filter((a) => mandate.forbiddenAllergens.includes(a));
  if (forbidden.length) why.push(`the mandate forbids ${forbidden.join(", ")}`);
  const labels = mandate.requiredCertificates.filter((x) => !p.certificates.includes(x));
  if (labels.length) why.push(`the mandate requires the label ${labels.join(", ")}`);
  if (mandate.substitution.rule === "none") why.push("the mandate allows no substitutes");
  else if (mandate.substitution.rule === "needs_approval") why.push("the mandate has a person approve every substitute");
  if (t.perUnitDiffPct !== null && t.perUnitDiffPct > mandate.substitution.maxPriceIncreasePct) why.push(`${t.perUnitDiffPct} % dearer per ${p.unit === "kg" ? "kilo" : "litre"}, over the ${mandate.substitution.maxPriceIncreasePct} % the mandate allows`);
  if (t.perUnitCents === null) why.push("no live price to compare with the usual");
  for (const s of stated) {
    if (s.family && s.family !== p.category) continue;
    if (s.kind === "require_claim" && !p.attributes.includes(s.claim)) why.push(`the kitchen's rule "${s.text}"`);
    if (s.kind === "forbid_allergen" && p.allergens.includes(s.allergen)) why.push(`the kitchen's rule "${s.text}"`);
  }
  return { inside: why.length === 0, outside: [...new Set(why)] };
}

const LABEL_ORDER: Record<string, number> = { exact: 0, variant: 1, standin: 3, other: 9 };
const TIER_ORDER: Record<string, number> = { best: 0, better: 1, good: 2 };

/** True when the mandate forbids the product outright (the gate would refuse it, not send it for sign-off). */
function refusedOutright(p: Product, mandate: Pick<Mandate, "allowedCategories" | "requiredAttributes" | "forbiddenAllergens" | "requiredCertificates">): boolean {
  return !mandate.allowedCategories.includes(p.category) || mandate.requiredAttributes.some((a) => !p.attributes.includes(a)) || p.allergens.some((a) => mandate.forbiddenAllergens.includes(a)) || mandate.requiredCertificates.some((x) => !p.certificates.includes(x));
}

/** One factual line from the figures (English, for steps and the ledger; the conversation words its own). */
function whyLine(t: TradeOff): string {
  const parts: string[] = [];
  const u = t.unit === "kg" ? "kilo" : "litre";
  if (t.perUnitDiffCents !== null) parts.push(t.perUnitDiffCents === 0 ? `same price per ${u}` : `${Math.abs(t.perUnitDiffCents / 100).toFixed(2)} € ${t.perUnitDiffCents > 0 ? "more" : "less"} per ${u}`);
  parts.push(`${t.packs} × ${t.packSize} ${t.unit === "L" ? "l" : t.unit}`);
  if (t.sameMaker) parts.push("same maker");
  else if (t.maker) parts.push(`made by ${t.maker}`);
  if (t.fat) parts.push(`fat ${fatText(t.fat.from)} → ${fatText(t.fat.to)}`);
  if (t.claimsLost.length) parts.push(`not ${t.claimsLost.join(", ").replaceAll("_", " ")}`);
  if (t.allergensAdded.length) parts.push(`contains ${t.allergensAdded.join(", ")}`);
  if (t.allergenDataMissing) parts.push("no allergen data");
  if (t.nutritionText) parts.push(t.nutritionText);
  if (t.wholesalerLists) parts.push("the wholesaler lists it as a substitute");
  if (t.reliability) parts.push(`on time ${t.reliability.pct} % (usual ${t.reliability.usualPct} %)`);
  if (t.carbon) parts.push(`${t.carbon.kgPerUnit} kg CO2e per ${u} (usual ${t.carbon.usualKgPerUnit})`);
  if (t.deliveryDate) parts.push(`can come ${t.deliveryDate}`);
  return parts.join("; ");
}

/**
 * Good, better, best: the substitutes that can come by the day, ranked by whether the agent may order them alone
 * (inside the kitchen's preferences), then the wholesaler's own substitute list, then how close they are (exact, variant, stand-in; the knowledge map's tier),
 * then price per litre or kilo. Products the mandate refuses outright, "not the kind" and the original are left out.
 * At most three; never padded.
 */
export function rankSubstitutes(original: Product, usualPerUnitCents: number | null, candidates: SubstituteCandidate[], need: { amount: number; date: string }, ctx: { mandate: Parameters<typeof insidePreferences>[3]; stated?: StatedPreference[] }): RankedSubstitute[] {
  const seen = new Set<string>([original.id]);
  const rows = candidates
    .filter((c) => !seen.has(c.product.id) && (seen.add(c.product.id), true))
    .filter((c) => c.label !== "other" && !refusedOutright(c.product, ctx.mandate))
    .map((c) => {
      const t = tradeOffOf(original, usualPerUnitCents, c, need);
      const pref = insidePreferences(original, c, t, ctx.mandate, ctx.stated);
      return { c, t, pref };
    })
    .filter((r) => r.t.onTime);
  rows.sort(
    (a, b) =>
      Number(b.pref.inside) - Number(a.pref.inside) ||
      Number(b.t.wholesalerLists) - Number(a.t.wholesalerLists) ||
      (LABEL_ORDER[a.c.label ?? ""] ?? (a.c.map?.sameKind ? 1 : 2)) - (LABEL_ORDER[b.c.label ?? ""] ?? (b.c.map?.sameKind ? 1 : 2)) ||
      (TIER_ORDER[a.c.map?.tier ?? ""] ?? 3) - (TIER_ORDER[b.c.map?.tier ?? ""] ?? 3) ||
      Number(b.t.sameMaker) - Number(a.t.sameMaker) ||
      (a.t.perUnitDiffCents ?? 1e9) - (b.t.perUnitDiffCents ?? 1e9),
  );
  const ranks = ["best", "better", "good"] as const;
  return rows.slice(0, 3).map((r, i) => ({ rank: ranks[i], productId: r.c.product.id, name: r.c.product.name, ...(r.c.label ? { label: r.c.label } : {}), ...(r.c.map ? { mapTier: r.c.map.tier } : {}), insidePreferences: r.pref.inside, outside: r.pref.outside, tradeOff: r.t, why: whyLine(r.t) }));
}

// ---------- when a key product cannot come ----------

export type Shortfall = { reason: "not_orderable" | "later" | "cutoff_passed"; backOn: string | null };

/**
 * Whether a product the kitchen needs on `date` can come: no usable offer (out of stock, blocked, not deliverable,
 * no price), its earliest delivery after the day, or the cut-off for it passed. `backOn`: the earliest day the
 * wholesaler says it can come, when it says one.
 */
export function shortfallOf(status: { offer?: LiveOffer; problems: string[]; orderable: boolean }, date: string): Shortfall | undefined {
  const o = status.offer;
  const blocking = ["out_of_stock", "sales_block", "not_deliverable", "no_price", "price_not_valid", "unit_mismatch", "unknown_product"];
  if (!status.orderable || status.problems.some((p) => blocking.includes(p))) return { reason: "not_orderable", backOn: o && o.deliveryDate > date ? o.deliveryDate : null };
  if (o && o.deliveryDate > date) return { reason: "later", backOn: o.deliveryDate };
  if (status.problems.includes("cutoff_passed")) return { reason: "cutoff_passed", backOn: o?.deliveryDate ?? null };
  return undefined;
}
