import type { Product } from "@/core/catalog";
import { addDaysIso, beforeCutoff, isoWeekday, latestDeliveryDay, localNow } from "@/core/kitchen";
import type { Mandate } from "@/core/mandate";
import { bigMilkBoxes } from "../demo-kitchen";
import type { ShowAgent, Json } from "./agent";

/**
 * Who plays which part in the week: the products, chosen by attribute from the catalogue the server runs on (the
 * partner's real one, or the seed in tests), and the delivery dates, all inside the kitchen's mandate. One planning
 * request checks the short lists live, once; the result is shared by every week for ten minutes, so a busy table
 * does not multiply the partner calls.
 */
export type Cast = {
  /** The kitchen's usual milk: the week's standing order, and the product that runs out on Wednesday. */
  milk: Product;
  milkPriceCents: number;
  /** The standing order that drifted: a plant drink when the catalogue has one the mandate allows, else milk. */
  drift: Product;
  driftPriceCents: number;
  /** Products in an allowed group that break the kitchen's allergen rule (Saturday's attempt), best first. */
  refusal: Product[];
  /** Delivery days inside the mandate's window, earliest first. */
  dates: string[];
  checkedAt: string;
  liveCalls: number;
};

const CACHE_MS = 10 * 60_000;
const g = globalThis as typeof globalThis & { __dockShowCast?: { key: string; at: number; cast: Cast } };

/** Delivery days from tomorrow to the mandate's latest day, on the kitchen's delivery weekdays. */
export function deliveryDates(now: Date, weekdays: number[], maxLeadDays: number, kitchenCutoff: boolean): string[] {
  const today = localNow(now).date;
  const last = latestDeliveryDay(now, maxLeadDays);
  const out: string[] = [];
  for (let d = addDaysIso(today, 1); d <= last; d = addDaysIso(d, 1)) {
    if (!weekdays.includes(isoWeekday(d))) continue;
    // A catalogue without per-product cut-offs (the seed) uses the kitchen's: 12:00 the day before.
    if (kitchenCutoff && !beforeCutoff(d, now)) continue;
    out.push(d);
  }
  return out;
}

const plain = (p: Product) => (p.kinds ?? []).length === 0;

export type CatalogueSearch = { searchProducts(q: { category?: string; attributes?: string[]; ids?: string[]; limit?: number }): Promise<Product[]> };

export async function castWeek(input: { agent: ShowAgent; catalog: CatalogueSearch; mandate: Mandate; now: Date; seed: boolean; weekdays: number[]; by: string }): Promise<Cast> {
  const { agent, catalog, mandate, now } = input;
  const dates = deliveryDates(now, input.weekdays, mandate.delivery.maxLeadDays, input.seed);
  const key = `${mandate.allowedCategories.join(",")}|${mandate.requiredAttributes.join(",")}|${mandate.forbiddenAllergens.join(",")}|${dates.join(",")}`;
  const hit = g.__dockShowCast;
  if (hit && hit.key === key && Date.now() - hit.at < CACHE_MS) return hit.cast;
  if (dates.length < 2) throw new Error(`Only ${dates.length} delivery day${dates.length === 1 ? "" : "s"} left inside the mandate's ${mandate.delivery.maxLeadDays}-day window today.`);

  const milks = await catalog.searchProducts({ category: "milk", attributes: ["lactose_free"], limit: 100 });
  const boxes = bigMilkBoxes(milks);
  const litreMilk = milks.filter((p) => p.unit === "L" && plain(p) && p.attributes.includes("fat_1_5") && !p.attributes.includes("organic"));
  const milkPool = [...boxes, ...litreMilk.filter((p) => !boxes.includes(p))].slice(0, 6);
  const allowed = (p: Product) => mandate.requiredAttributes.every((a) => p.attributes.includes(a)) && mandate.allowedCategories.includes(p.category);
  const safe = (p: Product) => !p.allergens.some((a) => mandate.forbiddenAllergens.includes(a)) && p.allergensDeclared !== false;
  const plants = mandate.allowedCategories.includes("plant_drink") ? await catalog.searchProducts({ category: "plant_drink", attributes: mandate.requiredAttributes, limit: 100 }) : [];
  const plantPool = plants.filter((p) => allowed(p) && safe(p) && p.unit === "L" && plain(p)).sort((a, b) => a.packSize - b.packSize || a.id.localeCompare(b.id)).slice(0, 2);
  const risky: Product[] = [];
  for (const cat of mandate.allowedCategories) {
    for (const p of await catalog.searchProducts({ category: cat, attributes: mandate.requiredAttributes, limit: 100 })) {
      if (allowed(p) && p.allergens.some((a) => mandate.forbiddenAllergens.includes(a)) && p.unit === "L") risky.push(p);
    }
  }
  const refusalPool = risky.sort((a, b) => a.packSize - b.packSize || a.id.localeCompare(b.id)).slice(0, 2);

  // One planning request, two short live lookups: the earliest day for the milk, the latest for the rest.
  const plan = await agent.openRequest("Planning the week ahead: which products can be delivered on the kitchen's days.", dates.at(-1));
  if (plan.status !== 201) throw new Error(plan.body.error?.message ?? `Could not open the planning request (HTTP ${plan.status}).`);
  const requestId = String(plan.body.request.requestId);
  let liveCalls = 0;
  const offersAt = async (ids: string[], date: string): Promise<Map<string, Json>> => {
    if (!ids.length) return new Map();
    const r = await agent.availability(requestId, ids, date);
    liveCalls += 1;
    if (r.status !== 200) throw new Error(r.body.error?.message ?? `The live lookup failed (HTTP ${r.status}).`);
    return new Map((r.body.offers ?? []).map((o: Json) => [String(o.productId), o]));
  };
  const early = await offersAt(milkPool.map((p) => p.id), dates[0]);
  const late = await offersAt([...plantPool, ...refusalPool].map((p) => p.id), dates.at(-1)!);
  const roomy = (p: Product, o: Json) => o.stockKnown === false || Number(o.availablePacks) * p.packSize >= 500;
  const milk = milkPool.find((p) => early.has(p.id) && roomy(p, early.get(p.id)!)) ?? milkPool.find((p) => early.has(p.id));
  if (!milk) throw new Error("No lactose-free milk the kitchen allows can be delivered on its next delivery day right now.");
  const plant = plantPool.find((p) => late.has(p.id));
  const cast: Cast = {
    milk,
    milkPriceCents: Number(early.get(milk.id)!.unitPriceCents),
    drift: plant ?? milk,
    driftPriceCents: plant ? Number(late.get(plant.id)!.unitPriceCents) : Number(early.get(milk.id)!.unitPriceCents),
    refusal: [...refusalPool.filter((p) => late.has(p.id)), ...refusalPool.filter((p) => !late.has(p.id))],
    dates,
    checkedAt: now.toISOString(),
    liveCalls,
  };
  g.__dockShowCast = { key, at: Date.now(), cast };
  return cast;
}

/** Tests only. */
export function forgetCast(): void {
  g.__dockShowCast = undefined;
}

/**
 * Which delivery day each step asks for. Milk orders must not share a day (the mistake check would rightly ask
 * "you already ordered for Tuesday"), and the stock-out gets the last day, which no other step prices, so the
 * live answers Dock reuses for two minutes never mix a simulated answer with a real one.
 */
export type DatePlan = { lastminute: string; standing?: string; slip?: string; stockout: string; drift?: string; refusal: string };

export function planDates(dates: string[], driftIsMilk: boolean): DatePlan {
  const n = dates.length;
  const stockout = dates[n - 1];
  const free = dates.slice(0, n - 1);
  const [lastminute, standing, slip, fourth] = free;
  return {
    lastminute,
    standing,
    slip,
    stockout,
    drift: driftIsMilk ? fourth : (dates[2] ?? dates[n - 1]),
    refusal: dates[n - 1],
  };
}
