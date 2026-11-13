import type { BestPlan, Built, OfferSpec } from "./types";
import { earliestDelivery } from "./world";

/**
 * The best achievable plan, computed from the world (never from an agent): the cheapest way to cover the need with
 * products that fully meet it (acceptance weight 1) and can arrive by the deadline, within the stock there is.
 * Prices and stock are taken after every scripted event, since a careful agent cannot outrun them; delivery dates
 * are taken at the start of the episode.
 */

export type Candidate = { productId: string; packSize: number; priceCents: number; packs: number };

const SCALE = 10; // work in tenths of a unit, so 1.5 L packs are whole numbers

export function bestPlan(built: Built): BestPlan {
  const { world, need } = built;
  const now = new Date(world.start);
  const final = new Map<string, OfferSpec>();
  for (const w of world.products) if (w.offer) final.set(w.key, { ...w.offer });
  for (const e of world.events) {
    const a = e.action;
    if (a.kind === "price") final.set(a.productKey, { ...final.get(a.productKey)!, unitPriceCents: a.unitPriceCents });
    if (a.kind === "stock") final.set(a.productKey, { ...final.get(a.productKey)!, availablePacks: a.availablePacks });
  }
  const candidates: Candidate[] = [];
  let earliest: string | undefined;
  for (const w of world.products) {
    const offer = final.get(w.key);
    if (!offer || offer.availablePacks <= 0) continue;
    if (w.product.unit !== need.unit || need.accept(w.product).weight < 1) continue;
    const { deliveryDate } = earliestDelivery(now, offer, world.deliveryWeekdays);
    if (!earliest || deliveryDate < earliest) earliest = deliveryDate;
    if (deliveryDate > need.deadline) continue;
    candidates.push({ productId: w.product.id, packSize: w.product.packSize, priceCents: offer.unitPriceCents, packs: offer.availablePacks });
  }
  const stock = candidates.reduce((s, c) => s + c.packs * c.packSize, 0);
  const target = Math.min(need.quantity, stock);
  if (target <= 0) return { achievableUnits: 0, costCents: 0, units: 0, lines: [], earliestAcceptableDelivery: earliest };
  return { achievableUnits: target, ...cheapestCover(candidates, target), earliestAcceptableDelivery: earliest };
}

/** Bounded knapsack, covering form: least cost to reach at least `target` units; ties go to the smaller overshoot. */
export function cheapestCover(candidates: Candidate[], target: number): { costCents: number; units: number; lines: { productId: string; packs: number }[] } {
  const t = Math.round(target * SCALE);
  const cap = t + Math.max(...candidates.map((c) => Math.round(c.packSize * SCALE)));
  // One layer per product: best cost to reach each amount using products 0..i, and how it was reached.
  type Layer = { cost: number[]; from: number[]; packs: number[] };
  let prev = new Array<number>(cap + 1).fill(Infinity);
  prev[0] = 0;
  const layers: Layer[] = [];
  for (const c of candidates) {
    const size = Math.round(c.packSize * SCALE);
    const layer: Layer = { cost: prev.slice(), from: new Array(cap + 1).fill(-1), packs: new Array(cap + 1).fill(0) };
    for (let a = 0; a <= cap; a++) {
      if (prev[a] === Infinity) continue;
      for (let k = 1; k <= c.packs; k++) {
        const b = Math.min(cap, a + k * size);
        const v = prev[a] + k * c.priceCents;
        if (v < layer.cost[b]) {
          layer.cost[b] = v;
          layer.from[b] = a;
          layer.packs[b] = k;
        }
        if (b === cap) break;
      }
    }
    layers.push(layer);
    prev = layer.cost;
  }
  let at = t;
  for (let a = t; a <= cap; a++) if (prev[a] < prev[at]) at = a;
  const costCents = prev[at];
  const lines: { productId: string; packs: number }[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.from[at] >= 0) {
      lines.unshift({ productId: candidates[i].productId, packs: l.packs[at] });
      at = l.from[at];
    }
  }
  const units = lines.reduce((s, l) => s + l.packs * candidates.find((c) => c.productId === l.productId)!.packSize, 0);
  return { costCents, units: Math.round(units * 100) / 100, lines };
}
