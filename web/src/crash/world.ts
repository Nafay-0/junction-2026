import { ProductSchema, type CatalogPort, type LiveOffer, type LiveOptions, type LiveProblem, type LiveStatus, type Product, type ProductQuery } from "@/core/catalog";
import { addDaysIso, isoWeekday, localNow } from "@/core/kitchen";
import type { OfferSpec, WorldProduct } from "./types";

/**
 * The scenario's wholesaler: a CatalogPort over the world's products, with per-product order cut-offs and a clock
 * the environment controls. Dock talks to it exactly as it talks to the partner's catalogue.
 */

/** Virtual time. Every tool call costs a minute; a human's answer costs what the scenario says. */
export class Clock {
  private t: number;
  readonly startMs: number;
  constructor(start: string) {
    this.t = Date.parse(start);
    this.startMs = this.t;
  }
  now = (): Date => new Date(this.t);
  iso = (): string => new Date(this.t).toISOString();
  advance(minutes: number): void {
    this.t += Math.round(minutes * 60_000);
  }
  minutes(): number {
    return (this.t - this.startMs) / 60_000;
  }
}

/** Scenarios are set in November, when Helsinki is UTC+2 (no summer time). */
export const HELSINKI_OFFSET = "+02:00";
export const helsinkiIso = (date: string, time: string) => `${date}T${time}:00${HELSINKI_OFFSET}`;

export function nextWeekday(date: string, weekdays: number[]): string {
  let d = date;
  for (let i = 0; i < 14 && !weekdays.includes(isoWeekday(d)); i++) d = addDaysIso(d, 1);
  return d;
}

/**
 * Earliest delivery an order placed `now` can get: the nominal day is `leadDays` after today (moved to a delivery
 * day); if its cut-off has passed, the next delivery day whose cut-off is still ahead.
 */
export function earliestDelivery(now: Date, spec: OfferSpec, weekdays: number[]): { deliveryDate: string; orderBy: string; cutoffPassed: boolean } {
  const local = localNow(now);
  const at = `${local.date}T${local.time}`;
  const nominal = nextWeekday(addDaysIso(local.date, spec.leadDays), weekdays);
  let d = nominal;
  for (let i = 0; i < 30; i++) {
    const cutoffDay = addDaysIso(d, -spec.cutoff.daysBefore);
    if (at < `${cutoffDay}T${spec.cutoff.time}`) return { deliveryDate: d, orderBy: helsinkiIso(cutoffDay, spec.cutoff.time), cutoffPassed: d !== nominal };
    d = nextWeekday(addDaysIso(d, 1), weekdays);
  }
  throw new Error("no delivery day within 30 days");
}

export class ScenarioCatalog implements CatalogPort {
  private readonly items: WorldProduct[];

  constructor(
    products: WorldProduct[],
    private readonly weekdays: number[],
    private readonly now: () => Date,
  ) {
    this.items = products.map((p) => ({ ...p, product: ProductSchema.parse(p.product), offer: p.offer && { ...p.offer } }));
  }

  async searchProducts(q: ProductQuery): Promise<Product[]> {
    const tokens = normalize(q.text ?? "").split(" ").filter(Boolean);
    const hits = this.items
      .map((x) => x.product)
      .filter((p) => {
        if (q.ids && !q.ids.includes(p.id)) return false;
        if (q.category && p.category !== q.category) return false;
        if (q.attributes && !q.attributes.every((a) => p.attributes.includes(a))) return false;
        if (q.forbiddenAllergens?.length) {
          // Unknown allergen data is excluded, not assumed safe.
          if (p.allergenInfo && !p.allergenInfo.declared) return false;
          if (p.allergens.some((a) => q.forbiddenAllergens!.includes(a))) return false;
        }
        const haystack = normalize([p.name, p.brand, p.category, ...p.attributes, p.names?.fi ?? ""].join(" "));
        return tokens.every((t) => haystack.includes(t));
      });
    return structuredClone(hits.slice(0, q.limit ?? 20));
  }

  async getLiveOffers(productIds: string[], options?: LiveOptions): Promise<LiveOffer[]> {
    const out: LiveOffer[] = [];
    for (const id of productIds) {
      const item = this.items.find((x) => x.product.id === id);
      if (!item?.offer) continue; // delisted: no offer
      const earliest = earliestDelivery(this.now(), item.offer, this.weekdays);
      // A later requested date is simply delivered then; an earlier one cannot be met (the earliest date stands).
      const deliveryDate = options?.deliveryDate && options.deliveryDate > earliest.deliveryDate ? options.deliveryDate : earliest.deliveryDate;
      out.push({
        productId: id,
        unitPriceCents: item.offer.unitPriceCents,
        availablePacks: item.offer.availablePacks,
        deliveryDate,
        ...(options?.deliveryDate ? { requestedDate: options.deliveryDate, laterThanRequested: deliveryDate > options.deliveryDate } : {}),
        orderBy: earliest.orderBy,
        cutoffPassed: earliest.cutoffPassed,
        logisticModel: item.offer.logistic,
        stockKnown: true,
        currency: "EUR",
        fetchedAt: this.now().toISOString(),
      });
    }
    return out;
  }

  /**
   * As the partner's API answers for a requested date: a product that would have made the date but for a passed
   * cut-off is reported cutoff_passed (Dock then refuses to quote it); one that is simply slower is
   * later_than_requested, with its true date.
   */
  async getLiveStatus(productIds: string[], options?: LiveOptions): Promise<LiveStatus[]> {
    const offers = await this.getLiveOffers(productIds, options);
    return productIds.map((id) => {
      const offer = offers.find((o) => o.productId === id);
      const item = this.items.find((x) => x.product.id === id);
      if (!offer || !item?.offer) return { productId: id, requestedDate: options?.deliveryDate, orderable: false, problems: ["unknown_product"], message: `No live offer for ${id}.` };
      const problems: LiveProblem[] = [];
      if (offer.availablePacks <= 0) problems.push("out_of_stock");
      const wanted = options?.deliveryDate;
      if (wanted && offer.deliveryDate > wanted) {
        problems.push("later_than_requested");
        const nominal = nextWeekday(addDaysIso(localNow(this.now()).date, item.offer.leadDays), this.weekdays);
        if (offer.cutoffPassed && nominal <= wanted) problems.push("cutoff_passed");
      }
      const orderable = offer.availablePacks > 0 && !problems.includes("cutoff_passed");
      const message = problems.length
        ? `${id}: ${problems.join(", ")}; earliest delivery ${offer.deliveryDate}${offer.cutoffPassed ? `, the cut-off for ${wanted ?? "the nominal day"} has passed` : ""}.`
        : `${id}: ${offer.availablePacks} packs, delivery ${offer.deliveryDate}.`;
      return { productId: id, requestedDate: wanted, orderable, problems, offer, message };
    });
  }

  /** Scripted events: a price moves, stock runs out. */
  patchOffer(key: string, patch: Partial<OfferSpec>): void {
    const item = this.items.find((x) => x.key === key);
    if (!item?.offer) throw new Error(`no offer for ${key}`);
    item.offer = { ...item.offer, ...patch };
  }

  offerOf(id: string): OfferSpec | undefined {
    return this.items.find((x) => x.product.id === id)?.offer;
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}
