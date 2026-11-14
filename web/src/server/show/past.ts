import type { Product } from "@/core/catalog";
import { addDaysIso, emptyMemory, isoWeekday, localNow, type HistoryEntry, type KitchenProfile, type MemoryItem } from "@/core/kitchen";

/**
 * The kitchen's past for the week: six weeks of orders and one standing order a person set, made up for the demo
 * like every visitor kitchen's history (sandboxes.ts gives each a hotel's past). It is installed when the week
 * starts and the kitchen's own past is put back when the week ends, so the visitor's kitchen is left as it was.
 *
 *   milk     Mondays and Thursdays, about 60 L of the usual lactose-free 1.5 % milk, chosen by price.
 *   drift    a standing order a person agreed ("about 20 L every Wednesday"), whose last orders crept up to twice
 *            that: the core's standing-order check catches the renewal before it repeats the drift.
 *
 * Products come from the catalogue the server runs on, chosen by attribute (see cast.ts), never by id.
 */
export const USUAL_MILK_LITRES = 80;
/** Litres of the past milk orders, oldest first: a steady pattern around USUAL_MILK_LITRES. */
const MILK_PATTERN = [80, 75, 80, 85, 80, 80, 75, 80, 85, 80];

export type DriftPlan = {
  family: string;
  product: Product;
  weekday: number;
  /** The amount a person agreed, and the band the standing order normally takes. */
  agreed: number;
  low: number;
  high: number;
  /** The last orders, oldest first: flat, then creeping. */
  amounts: number[];
};

export function driftPlan(family: string, product: Product, weekday: number): DriftPlan {
  // Litres the standing order took, oldest first. The last one is what "same as last time" would repeat.
  const base = family === "milk" ? USUAL_MILK_LITRES : 20;
  const amounts = [1, 1, 1, 1.3, 1.6, 2].map((f) => Math.round(base * f));
  return { family, product, weekday, agreed: base, low: Math.round(base * 0.9), high: Math.round(base * 1.1), amounts };
}

function entry(p: Product, litres: number, delivery: string, orderId: string, priceCents: number): HistoryEntry {
  const packs = Math.max(1, Math.round(litres / p.packSize));
  return {
    orderId,
    placedAt: `${addDaysIso(delivery, -2)}T07:00:00.000Z`,
    neededBy: delivery,
    deliveryDate: delivery,
    family: p.category,
    amount: Math.round(packs * p.packSize * 100) / 100,
    unit: p.unit,
    totalCents: packs * priceCents,
    lines: [{ productId: p.id, name: p.name, category: p.category, attributes: p.attributes, packs, packSize: p.packSize, unit: p.unit, unitPriceCents: priceCents }],
    chosenLabels: ["best_price"],
  };
}

/** Delivery dates on a weekday, before today, most recent `count`, oldest first. */
function pastOn(now: Date, weekdays: number[], count: number): string[] {
  const today = localNow(now).date;
  const out: string[] = [];
  for (let d = addDaysIso(today, -60); d < addDaysIso(today, -2); d = addDaysIso(d, 1)) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out.slice(-count);
}

/**
 * The profile the week runs on. `prices` are plausible per-pack prices for the history (the partner's live price
 * when the show looked it up, else a food-service level); history prices never become a quote.
 */
export function weekProfile(input: {
  orgId: string;
  name: string;
  now: Date;
  milk: Product;
  milkPriceCents: number;
  drift: DriftPlan;
  driftPriceCents: number;
  statedBy: string;
}): KitchenProfile {
  const { orgId, name, now, milk, drift } = input;
  const prefix = `ord_past_${orgId.slice(-6)}_`;
  const milkDays = pastOn(now, [1, 4], MILK_PATTERN.length);
  const history: HistoryEntry[] = milkDays.map((d, i) => entry(milk, MILK_PATTERN[i], d, `${prefix}m${String(i + 1).padStart(2, "0")}`, input.milkPriceCents));
  const driftDays = pastOn(now, [drift.weekday], drift.amounts.length);
  history.push(...driftDays.map((d, i) => entry(drift.product, drift.amounts[i], d, `${prefix}d${String(i + 1).padStart(2, "0")}`, input.driftPriceCents)));
  history.sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const agreedAt = `${addDaysIso(localNow(now).date, -45)}T09:00:00.000Z`;
  const dayName = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][drift.weekday];
  const standing: MemoryItem = {
    id: `mem_show_standing_${orgId.slice(-6)}`,
    fact: { kind: "standing_order", weekdays: [drift.weekday], amount: drift.agreed, unit: drift.product.unit, low: drift.low, high: drift.high },
    text: `${dayName} standing order: about ${drift.agreed} ${drift.product.unit} of ${shortName(drift.product.name)}`,
    family: drift.family,
    strength: "rule",
    origin: "stated",
    status: "active",
    audience: "shared",
    safety: false,
    weight: 1,
    confirmations: 1,
    contradictions: 0,
    sources: [{ door: "memory_page", at: agreedAt, by: input.statedBy, quote: `Every ${dayName}, about ${drift.agreed} litres, please.` }],
    createdAt: agreedAt,
    updatedAt: agreedAt,
    history: [{ at: agreedAt, change: "stated", by: input.statedBy }],
  };
  return {
    orgId,
    name,
    deliveryWeekdays: [1, 2, 3, 4, 5, 6],
    history,
    stated: [],
    memory: { ...emptyMemory(), items: [standing] },
  };
}

/** "Alpro Soya drink, Original 1L" -> "Alpro Soya drink". */
export function shortName(name: string): string {
  const head = name.split(",")[0].trim();
  return head.length > 48 ? `${head.slice(0, 46)}…` : head;
}
