import type { HistoryEntry } from "@/core/kitchen";

/**
 * "You probably still have 6 kg from Thursday's delivery": what a menu line may already be in the kitchen, from its
 * own records only. Plain code, no model, and never silent: the menu card says it on the line and one tap buys it.
 *
 * The estimate: the last delivery of the line's product (or of the same kind in the same product group), used up
 * evenly until the kitchen's next usual delivery of it (the median days between its deliveries; a week when there is
 * only one). What is left today counts as in stock only when it covers everything the menu needs; a part never does.
 */

export type StockLine = {
  lineId: string;
  /** The ingredient in plain words ("whipping cream"). */
  name: string;
  need: { amount: number; unit: string };
  /** The products the line could be bought as (its candidates). */
  productIds: string[];
  /** The product group of the line's product, and words of its kind, for a delivery of the same kind. */
  category?: string;
  kindWords: string[];
};

export type StockGuess = { lineId: string; amount: number; unit: string; deliveredOn: string; productId: string };

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function stockFromRecords(history: HistoryEntry[], lines: StockLine[], today: string): StockGuess[] {
  const delivered = history.filter((h) => h.deliveryDate <= today).sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
  const out: StockGuess[] = [];
  for (const l of lines) {
    if (!(l.need.amount > 0)) continue;
    const words = l.kindWords.map((w) => w.toLowerCase()).filter((w) => w.length > 2);
    const matches = (x: HistoryEntry["lines"][number]) =>
      l.productIds.includes(x.productId) || (!!l.category && x.category === l.category && words.length > 0 && words.every((w) => x.name.toLowerCase().includes(w)));
    const hits = delivered.filter((h) => h.lines.some((x) => matches(x) && x.unit === l.need.unit));
    if (!hits.length) continue;
    const last = hits[0];
    const since = days(last.deliveryDate, today);
    const gaps = hits.slice(0, 6).flatMap((h, i) => (i + 1 < hits.length ? [days(hits[i + 1].deliveryDate, h.deliveryDate)] : [])).filter((g) => g > 0);
    const interval = gaps.length ? median(gaps) : 7;
    if (since >= interval) continue;
    const got = last.lines.filter((x) => matches(x) && x.unit === l.need.unit).reduce((s, x) => s + x.packs * x.packSize, 0);
    const left = Math.floor(got * (1 - since / interval) * 10) / 10;
    if (left >= l.need.amount) out.push({ lineId: l.lineId, amount: left, unit: l.need.unit, deliveredOn: last.deliveryDate, productId: last.lines.find(matches)!.productId });
  }
  return out;
}
