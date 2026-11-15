import type { Product } from "@/core/catalog";
import { lineMarks, type LineMarks } from "@/core/line-marks";
import { warnLevel } from "../reliability/service";

/**
 * The delivery record and carbon estimate for a card's line (core/line-marks.ts), read from the catalogue index the
 * server already holds: a synchronous lookup by product id that the runtime registers once it has its catalogue
 * (server/runtime.ts). No model, no live call. Without a registered catalogue (a unit test) a line simply has no
 * marks, and the card is drawn as before.
 */

type Lookup = (productId: string) => Product | undefined;
const g = globalThis as typeof globalThis & { __dockMarkProducts?: Lookup };

export function setMarkProducts(lookup: Lookup | undefined): void {
  g.__dockMarkProducts = lookup;
}

/** `{ marks }` for a line of `packs` packs of the product, or `{}` when nothing is known (spread into a line). */
export function marksFor(productId: string, packs: number, product?: Product): { marks?: LineMarks } {
  let p = product;
  try {
    p ??= g.__dockMarkProducts?.(productId);
  } catch {
    p = undefined;
  }
  if (!p) return {};
  const m = lineMarks(p, packs, warnLevel());
  return m.delivery || m.co2Kg !== undefined ? { marks: m } : {};
}

/**
 * An option's marks from its lines: the weakest delivery record among them (an option with one poor product says so),
 * and the footprint only when every line has an estimate (a part is never shown as the whole).
 */
export function optionMarks(lines: { productId: string; quantity: number }[]): { marks?: LineMarks } {
  const each = lines.map((l) => marksFor(l.productId, l.quantity).marks);
  const delivery = each.flatMap((m) => (m?.delivery ? [m.delivery] : [])).sort((a, b) => a.share - b.share)[0];
  const co2 = each.every((m) => m?.co2Kg !== undefined) && each.length ? Math.round(each.reduce((s, m) => s + m!.co2Kg!, 0) * 100) / 100 : undefined;
  const m: LineMarks = { ...(delivery ? { delivery } : {}), ...(co2 !== undefined ? { co2Kg: co2 } : {}) };
  return m.delivery || m.co2Kg !== undefined ? { marks: m } : {};
}
