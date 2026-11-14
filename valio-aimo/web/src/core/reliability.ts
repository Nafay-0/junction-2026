import type { Product } from "./catalog";
import type { RankedSubstitute } from "./watch";

/**
 * A product's delivery record, as plain code reads it (no model): the share of past deliveries that arrived as
 * ordered, from the wholesaler's delivery-reliability file (synthetic history, one figure per product, 0 to 1). It is
 * history, never a forecast: the words are "has arrived as ordered about N times in 10", never "will not arrive".
 *
 * The threshold, from the data's own distribution (17,546 products, 4,413 with a figure, 14 Nov 2026): the median is
 * 1.00 (most products always arrived), the worst tenth starts at 0.94 and the worst twentieth at 0.875. Below 0.90
 * means more than one delivery in ten was short or late: 279 products (6.3 % of those with a figure), the line where a
 * kitchen would want a backup lined up. A product with no figure is never flagged. DOCK_RELIABILITY_WARN overrides it.
 */
export const RELIABILITY_WARN = 0.9;

export type DeliveryRecord = {
  /** Share of past deliveries that arrived as ordered, 0..1. */
  share: number;
  /** "about 7 times in 10": n of `of` (10, or 20 when tenths would round a poor record up to 9 or 10). */
  n: number;
  of: 10 | 20;
  /** Below the threshold. */
  poor: boolean;
  /** One English phrase, for steps, the ledger and outside agents. */
  words: string;
};

/** The product's record, or undefined when the data has no figure for it (never guessed). */
export function deliveryRecordOf(p: Pick<Product, "deliveryReliability" | "deliveryReliabilityKnown">, warn = RELIABILITY_WARN): DeliveryRecord | undefined {
  if (p.deliveryReliabilityKnown === false || !(p.deliveryReliability > 0)) return undefined;
  const share = Math.round(p.deliveryReliability * 1000) / 1000;
  const tenths = Math.round(share * 10);
  // 0.86 is "about 17 times in 20", not "about 9 times in 10" (which reads as a good record).
  const twenties = share < warn && tenths >= 9;
  const n = twenties ? Math.round(share * 20) : tenths;
  const of = twenties ? 20 : 10;
  return { share, n, of, poor: share < warn, words: `has arrived as ordered about ${n} times in ${of}` };
}

/** The products on an order whose record is poor, worst first. */
export function poorRecords<T extends { product: Pick<Product, "id" | "deliveryReliability" | "deliveryReliabilityKnown"> }>(lines: T[], warn = RELIABILITY_WARN): (T & { record: DeliveryRecord })[] {
  return lines
    .flatMap((l) => {
      const record = deliveryRecordOf(l.product, warn);
      return record?.poor ? [{ ...l, record }] : [];
    })
    .sort((a, b) => a.record.share - b.record.share);
}

/**
 * The alternatives worth lining up as a backup: the watch's good/better/best (core/watch.ts rankSubstitutes), only
 * those whose own record is better than the product's (or not known to be worse: no figure is said as no figure),
 * at most three, ranked again in order.
 */
export function backupCandidates(record: DeliveryRecord, ranked: RankedSubstitute[], recordOf: (productId: string) => DeliveryRecord | undefined): (RankedSubstitute & { record?: DeliveryRecord })[] {
  const ranks = ["best", "better", "good"] as const;
  return ranked
    .map((r) => ({ ...r, record: recordOf(r.productId) }))
    .filter((r) => !r.record || r.record.share > record.share)
    .slice(0, 3)
    .map((r, i) => ({ ...r, rank: ranks[i] }));
}

/** "You choose": the best alternative inside the kitchen's preferences, else none (a person then picks). */
export function chooseForKitchen<T extends { insidePreferences: boolean }>(alternatives: T[]): T | undefined {
  return alternatives.find((a) => a.insidePreferences);
}
