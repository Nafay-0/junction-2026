import type { HistoryEntry, HistoryLine } from "./kitchen";
import { addDaysIso } from "./kitchen";
import { formatAmount } from "./catalog/pack";
import type { BaseUnit } from "./need";

/**
 * What a kitchen probably has on hand of one ingredient on the day it cooks, and so what it must still buy. Plain
 * code, no model, and every figure says where it came from:
 *
 *   bought   an estimate from the kitchen's own order history: what it bought of the products that are this
 *            ingredient, when, and how fast it usually goes through them (the amount between its first and last
 *            delivery over the days between them). What is left on the service day is the last delivery less
 *            that rate up to the day. Labelled an estimate, always.
 *   said     the chef said so ("I have butter and flour"): the whole need when no amount was said, else that amount
 *   pantry   the kitchen's standing list of staples it always keeps (salt, pepper): the whole need
 *   unknown  nothing known: nothing is assumed on hand
 *
 * A staple the kitchen bought once, recently, in a pack far larger than the dish needs (a kilo of bouillon powder
 * for 80 g) counts as on hand: a single purchase tells no rate, but a dish's pinch of it is not what runs it out.
 */

export type Qty = { amount: number; unit: BaseUnit };

export type OnHandSource =
  | { kind: "bought"; productId: string; name: string; lastDelivered: string; lastAmount: Qty; orders: number; perDay: number | null; until: string }
  | { kind: "said"; words: string; amount?: Qty }
  | { kind: "pantry"; item: string }
  | { kind: "unknown" };

/** On hand on the service day. `amount: null` means "enough": said or kept without a figure. */
export type OnHand = { amount: number | null; unit: BaseUnit; source: OnHandSource; estimate: boolean; text: string };

export type Shortfall = { need: Qty; onHand: OnHand; toBuy: Qty; covered: boolean };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const fmt = (q: Qty) => (q.unit === "pcs" ? `${Math.round(q.amount * 10) / 10} pcs` : formatAmount(Math.round(q.amount * 100) / 100, q.unit));
const day = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
};
export const formatQty = fmt;

/** The amount one history line delivered, in the base unit, or undefined when it was sold in another measure. */
export function lineAmount(l: Pick<HistoryLine, "packs" | "packSize" | "unit">, unit: BaseUnit): number | undefined {
  return l.unit === unit ? l.packs * l.packSize : undefined;
}

/** A single purchase this recent, in a pack at least this many times the need, makes a staple count as on hand. */
export const STAPLE_RECENT_DAYS = 30;
export const STAPLE_PACK_MULTIPLE = 4;

/**
 * The estimate from history: `match` says which history lines are this ingredient (a product the line could buy).
 * `serviceDate` is the day the dish is cooked. Undefined when the kitchen never bought it in this measure.
 */
export function estimateFromHistory(history: readonly HistoryEntry[], match: (l: HistoryLine) => boolean, need: Qty, serviceDate: string, opts: { staple?: boolean } = {}): OnHand | undefined {
  const deliveries: { date: string; amount: number; productId: string; name: string }[] = [];
  for (const e of history) {
    const lines = e.lines.filter(match);
    const amount = lines.reduce((s, l) => s + (lineAmount(l, need.unit) ?? 0), 0);
    if (lines.length && amount > 0) deliveries.push({ date: e.deliveryDate, amount, productId: lines[0].productId, name: lines[0].name });
  }
  const past = deliveries.filter((d) => d.date <= serviceDate).sort((a, b) => a.date.localeCompare(b.date));
  if (!past.length) return undefined;
  const last = past[past.length - 1];
  const span = days(past[0].date, last.date);
  // Used between the first delivery and the last: everything delivered before the last one, over those days.
  const perDay = past.length >= 2 && span > 0 ? past.slice(0, -1).reduce((s, d) => s + d.amount, 0) / span : null;
  const since = Math.max(0, days(last.date, serviceDate));
  const base = { productId: last.productId, name: last.name, lastDelivered: last.date, lastAmount: { amount: r3(last.amount), unit: need.unit }, orders: past.length, until: serviceDate };
  if (perDay === null) {
    const staple = opts.staple && since <= STAPLE_RECENT_DAYS && last.amount >= need.amount * STAPLE_PACK_MULTIPLE;
    const amount = staple ? r3(last.amount) : 0;
    return {
      amount,
      unit: need.unit,
      estimate: true,
      source: { kind: "bought", ...base, perDay: null },
      text: staple
        ? `estimate: bought ${fmt(base.lastAmount)} on ${day(last.date)}, a staple far larger than the ${fmt(need)} this needs, so taken as on hand`
        : `estimate: bought ${fmt(base.lastAmount)} once, on ${day(last.date)}; how fast it is used is not known, so nothing is assumed left`,
    };
  }
  const left = Math.max(0, r3(last.amount - perDay * since));
  return {
    amount: left,
    unit: need.unit,
    estimate: true,
    source: { kind: "bought", ...base, perDay: r3(perDay) },
    text: `estimate: bought ${fmt(base.lastAmount)} on ${day(last.date)} (${past.length} deliveries), goes through about ${fmt({ amount: perDay, unit: need.unit })} a day, so about ${fmt({ amount: left, unit: need.unit })} left by ${day(serviceDate)}`,
  };
}

export function saidOnHand(words: string, unit: BaseUnit, amount?: Qty): OnHand {
  return { amount: amount && amount.unit === unit ? amount.amount : null, unit, estimate: false, source: { kind: "said", words, ...(amount ? { amount } : {}) }, text: amount ? `said by the chef: "${words}" (${fmt(amount)})` : `said by the chef: "${words}"` };
}

export function pantryOnHand(item: string, unit: BaseUnit): OnHand {
  return { amount: null, unit, estimate: false, source: { kind: "pantry", item }, text: `on the kitchen's list of staples it always keeps (${item})` };
}

export function unknownOnHand(unit: BaseUnit): OnHand {
  return { amount: 0, unit, estimate: false, source: { kind: "unknown" }, text: "nothing known on hand, so none assumed" };
}

/** The need less what is on hand, never below zero. "Enough" (amount null) covers it all. */
export function shortfall(need: Qty, onHand: OnHand): Shortfall {
  if (onHand.unit !== need.unit) return { need, onHand: unknownOnHand(need.unit), toBuy: need, covered: false };
  const have = onHand.amount === null ? need.amount : onHand.amount;
  const toBuy = Math.max(0, r3(need.amount - have));
  return { need, onHand, toBuy: { amount: toBuy, unit: need.unit }, covered: toBuy <= 1e-9 };
}

/** The strongest thing known: what the chef said beats the pantry list, which beats an estimate, which beats nothing. */
export function bestOnHand(candidates: (OnHand | undefined)[], unit: BaseUnit): OnHand {
  const order: OnHandSource["kind"][] = ["said", "pantry", "bought"];
  for (const kind of order) {
    const found = candidates.find((c) => c && c.source.kind === kind && c.unit === unit);
    if (found) return found;
  }
  return unknownOnHand(unit);
}

// ---------- what the chef says they have ----------

const HAVE_LEAD = /\b(?:i|we)\s+(?:already\s+)?(?:have|has|got|'ve got)\b|\bwe'?ve\s+got\b|\b(?:there is|there's)\s+(?:already\s+)?\b|\bmeillä\s+on(?:\s+jo)?\b|\bminulla\s+on(?:\s+jo)?\b|\bon\s+jo\b|\bvi\s+har(?:\s+redan)?\b|\bjag\s+har(?:\s+redan)?\b/iu;
const STOP = /\b(?:for|by|on|to|but|so|and need|need|tarvitaan|tarvitsemme|mutta|men|behöver)\b/iu;
const AMOUNT = /^(?:about\s+|noin\s+|ca\.?\s+)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|ml|kpl|pcs|st)\b\s*(?:of\s+)?/iu;

export type SaidItem = { words: string; item: string; amount?: Qty };

/**
 * The items a chef says they have, in their words ("I have butter and flour", "meillä on jo voita ja 2 kg jauhoja",
 * "vi har smör"). Plain code: the words after "I have / we have / meillä on / vi har", split on commas and "and / ja /
 * och", each with an amount when one is written. Not a model's guess: what is not said is not assumed.
 */
export function saidHave(text: string): SaidItem[] {
  const out: SaidItem[] = [];
  const sentences = text.split(/[.;!?\n]+/);
  for (const s of sentences) {
    const m = HAVE_LEAD.exec(s);
    if (!m) continue;
    let rest = s.slice(m.index + m[0].length);
    const stop = STOP.exec(rest);
    if (stop) rest = rest.slice(0, stop.index);
    for (const raw of rest.split(/,|\band\b|\bja\b|\boch\b|&/iu)) {
      let part = raw.trim().replace(/^(?:some|plenty of|enough|a lot of|lots of|jo|already|redan)\s+/iu, "").trim();
      if (!part) continue;
      let amount: Qty | undefined;
      const a = AMOUNT.exec(part);
      if (a) {
        const n = Number(a[1].replace(",", "."));
        const u = a[2].toLowerCase();
        amount = u === "kg" ? { amount: n, unit: "kg" } : u === "g" ? { amount: n / 1000, unit: "kg" } : u === "l" ? { amount: n, unit: "L" } : u === "dl" ? { amount: n / 10, unit: "L" } : u === "ml" ? { amount: n / 1000, unit: "L" } : { amount: n, unit: "pcs" };
        part = part.slice(a[0].length).trim();
      }
      part = part.replace(/\s+(?:in stock|on hand|here|varastossa|i lager)$/iu, "").trim();
      if (part.length < 2 || part.length > 40) continue;
      out.push({ words: raw.trim(), item: part.toLowerCase(), ...(amount ? { amount } : {}) });
    }
  }
  return out;
}

/** Stems of the item that must appear in an ingredient's words (English, Finnish, Swedish inflections cut short). */
function stems(item: string): string[] {
  return item
    .toLowerCase()
    .split(/[^a-zåäö]+/u)
    .filter((w) => w.length >= 3)
    // Inflections cut short: "jauhoja" -> "jauho", "voita" -> "voi", "cream" -> "crea"; four letters or fewer stay.
    .map((w) => (w.length >= 6 ? w.slice(0, w.length - 2) : w.length === 5 ? (/(ta|tä)$/u.test(w) ? w.slice(0, 3) : w.slice(0, 4)) : w));
}

/** Does what the chef said they have name this ingredient? By stems in its name or its search words. */
export function saidCovers(said: SaidItem, ingredientWords: string[]): boolean {
  const hay = ` ${ingredientWords.join(" ").toLowerCase()} `;
  const s = stems(said.item);
  return s.length > 0 && s.every((w) => hay.includes(w));
}

/** The service day minus a number of days, for tests and callers that count back. */
export const daysBefore = (date: string, n: number) => addDaysIso(date, -n);
