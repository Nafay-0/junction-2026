import type { BaseUnit } from "./need";

/**
 * Which pack to buy for a small need: the smallest pack that covers it, so a recipe needing 80 g of bouillon is not
 * sent a 1.5 kg tub when the assortment has a 500 g one. Plain code over pack sizes from master data; the live price
 * call then sees the packs that fit, and the price ranking picks among those.
 *
 *   packFit        how many packs of a size cover a need, and what is left over
 *   orderByFit     a line's products, best fit first among those that fit the ingredient about as well
 *   leftoverNote   "1 × 1,5 kg for 80 g: about 1,42 kg left over" when even the smallest pack is far more than needed
 */

export type Fit = { packs: number; delivered: number; leftover: number; leftoverShare: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function packFit(need: number, packSize: number): Fit {
  if (!(packSize > 0) || !(need > 0)) return { packs: 0, delivered: 0, leftover: 0, leftoverShare: 0 };
  const packs = Math.max(1, Math.ceil(need / packSize - 1e-9));
  const delivered = r3(packs * packSize);
  const leftover = r3(delivered - need);
  return { packs, delivered, leftover, leftoverShare: delivered > 0 ? r3(leftover / delivered) : 0 };
}

/** A need this small next to a pack is a "small need": the pack choice is then about leftover, not price per kilo. */
export const SMALL_NEED_SHARE = 0.5;
/** Within this share of the best score, products are taken to fit the ingredient equally well. */
export const SCORE_TOLERANCE = 0.8;
/** Leftover above this share of what is delivered, and more than the need itself, is said. */
export const LEFTOVER_SAY_SHARE = 0.5;
/** For a need under a tenth of the best-scored pack: products within this share of the best score are compared by pack. */
export const WIDE_TOLERANCE = 0.6;

export type Sized = { id: string; score: number; packSize: number | undefined };

/**
 * The products of a line in the order to price them: unchanged for a need that fills its packs, but for a small
 * need, among products that fit the ingredient about as well as the best one (score within SCORE_TOLERANCE), the
 * pack that leaves least over comes first. Products whose pack size is unknown keep their place after the sized
 * ones. Never brings in a product the search did not find, and never drops one.
 */
export function orderByFit<T extends Sized>(items: readonly T[], need: number | undefined): T[] {
  if (!need || need <= 0 || items.length < 2) return [...items];
  const top = Math.max(...items.map((i) => i.score));
  // A tiny need against the top pack (6 l of stock from a 333 l tub) widens the pool: a smaller pack of the same thing
  // scored a little lower is still the better buy.
  const best = items.find((i) => i.score === top)?.packSize;
  const tolerance = best && need < best * 0.1 ? WIDE_TOLERANCE : SCORE_TOLERANCE;
  const close = items.filter((i) => i.score >= top * tolerance && i.packSize && i.packSize > 0);
  const smallest = Math.min(...close.map((i) => i.packSize!));
  // Only a small need: when even the smallest pack fitting about as well is several times the need.
  if (!close.length || need >= smallest * SMALL_NEED_SHARE) return [...items];
  const fitted = [...close].sort((a, b) => packFit(need, a.packSize!).leftover - packFit(need, b.packSize!).leftover || b.score - a.score);
  return [...fitted, ...items.filter((i) => !fitted.includes(i))];
}

/** What is left over, in words, when the pack is far more than the need. Undefined when it is not worth saying. */
export function leftoverNote(need: number, packSize: number, unit: BaseUnit, fmt: (amount: number, unit: BaseUnit) => string): string | undefined {
  const f = packFit(need, packSize);
  if (!f.packs || f.leftover <= need || f.leftoverShare < LEFTOVER_SAY_SHARE) return undefined;
  return `${f.packs} × ${fmt(packSize, unit)} for ${fmt(need, unit)}: about ${fmt(f.leftover, unit)} left over, the smallest pack found that covers it`;
}
