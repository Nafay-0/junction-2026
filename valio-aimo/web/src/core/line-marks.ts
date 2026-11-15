import type { Product } from "./catalog";
import { RELIABILITY_WARN, deliveryRecordOf } from "./reliability";

/**
 * The two quiet figures shown beside what will be bought (the thread's lists, option rows and dishes), from the
 * wholesaler's own files through the catalogue index: no model, no live call.
 *
 * - `delivery`: the product's delivery record (core/reliability.ts deliveryRecordOf): the share of past deliveries
 *   that arrived as ordered, said as "about n in 10" (or 20), and whether it is below the warn level. History, never a
 *   forecast. Absent when the file has no figure for the product: never shown as 0.
 * - `co2Kg`: an estimate for the line: the product GROUP's average kg CO2e per kilo (a litre counted as a kilo, as the
 *   basket counts it) times the kilos or litres on the line. Not a measurement of the product; always said with "≈".
 *   Absent when the group has no figure, or the line is pieces with no known weight or volume.
 */
export type LineMarks = {
  delivery?: { share: number; n: number; of: 10 | 20; poor: boolean };
  co2Kg?: number;
};

/** Kilos or litres in `packs` of the product (a litre counted as a kilo), or undefined for pieces without a weight. */
export function lineMeasure(p: Pick<Product, "unit" | "packSize" | "packContent">, packs: number): number | undefined {
  if (!(packs > 0)) return undefined;
  const pc = p.packContent;
  if (pc) {
    const per = pc.perSalesUnit.L ?? pc.perSalesUnit.kg;
    return per !== undefined && per > 0 ? per * packs : undefined;
  }
  return p.unit === "pcs" || !(p.packSize > 0) ? undefined : p.packSize * packs;
}

/** The line's carbon estimate in kg CO2e, or undefined when there is no figure to base it on. */
export function lineCo2Kg(p: Pick<Product, "unit" | "packSize" | "packContent" | "carbonGroupAvgKgCo2ePerKg" | "carbonKgPerUnit" | "carbonKnown">, packs: number): number | undefined {
  const amount = lineMeasure(p, packs);
  if (amount === undefined) return undefined;
  const perKg = p.carbonGroupAvgKgCo2ePerKg;
  // A partner product: its group's average per kilo, or nothing (null: the group has no figure).
  if (perKg !== undefined) return perKg !== null && perKg > 0 ? round(perKg * amount) : undefined;
  // The built-in sample assortment: its per-unit figure (per litre or kilo), when it has one.
  return p.carbonKnown !== false && p.carbonKgPerUnit > 0 ? round(p.carbonKgPerUnit * amount) : undefined;
}

/** Both figures for a line of `packs` packs; an empty object when neither is known. */
export function lineMarks(p: Product, packs: number, warn = RELIABILITY_WARN): LineMarks {
  const r = deliveryRecordOf(p, warn);
  const co2Kg = lineCo2Kg(p, packs);
  return {
    ...(r ? { delivery: { share: r.share, n: r.n, of: r.of, poor: r.poor } } : {}),
    ...(co2Kg !== undefined ? { co2Kg } : {}),
  };
}

export type MarksSummary = {
  /** Lines in the list. */
  lines: number;
  /** Lines with a delivery record, and of those the ones below the warn level. */
  withRecord: number;
  poor: number;
  /** The sum of the known carbon estimates, and over how many lines. */
  co2Kg?: number;
  co2Lines: number;
};

/** The list's summary under its total: how many records are poor, and the footprint of the lines that have one. */
export function marksSummary(marks: (LineMarks | undefined)[]): MarksSummary {
  const withRecord = marks.filter((m) => m?.delivery).length;
  const poor = marks.filter((m) => m?.delivery?.poor).length;
  const co2 = marks.flatMap((m) => (m?.co2Kg !== undefined ? [m.co2Kg] : []));
  return { lines: marks.length, withRecord, poor, ...(co2.length ? { co2Kg: round(co2.reduce((s, x) => s + x, 0)) } : {}), co2Lines: co2.length };
}

/** Five pips for a share: how many are filled (0..5). */
export const pipsOf = (share: number) => Math.max(0, Math.min(5, Math.round(share * 5)));

const round = (x: number) => Math.round(x * 100) / 100;
