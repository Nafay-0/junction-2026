import { z } from "zod";
import { addDays, isoDate } from "./util";

/** Product master data: what the partner ships as files. Local, cheap to query. */
export const ProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  category: z.string().min(1), // "milk", "plant_drink", "cream", ...
  unit: z.enum(["L", "kg", "pcs"]),
  packSize: z.number().positive(), // units per pack, e.g. 10 (L) for a bag-in-box
  attributes: z.array(z.string()), // "lactose_free", "organic", "fat_1_5", ...
  allergens: z.array(z.string()),
  certificates: z.array(z.string()), // labels such as "hyvaa_suomesta", "eu_organic"
  deliveryReliability: z.number().min(0).max(1), // share of past deliveries on time
  carbonKgPerUnit: z.number().nonnegative(), // kg CO2e per unit (per litre, per kg)
});
export type Product = z.infer<typeof ProductSchema>;

/** Live price and stock for one product: what the partner's pricing/availability API returns. */
export type LiveOffer = {
  productId: string;
  unitPriceCents: number; // per pack
  availablePacks: number;
  deliveryDate: string; // YYYY-MM-DD, earliest possible delivery
};

export const ProductQuerySchema = z.object({
  text: z.string().optional(),
  category: z.string().optional(),
  attributes: z.array(z.string()).optional(),
  ids: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional(),
});
export type ProductQuery = z.infer<typeof ProductQuerySchema>;

/**
 * The only thing Dock knows about the wholesaler's systems. Two operations, kept apart on purpose:
 * - searchProducts reads master data (local, call freely);
 * - getLiveOffers asks the partner's live price/availability API (call sparingly, for a short list only).
 * Replace the in-memory implementation with an HTTP adapter for the partner's mock API; nothing else changes.
 */
export interface CatalogPort {
  searchProducts(query: ProductQuery): Promise<Product[]>;
  getLiveOffers(productIds: string[]): Promise<LiveOffer[]>;
}

export const MAX_LIVE_IDS_PER_CALL = 10;

export class CatalogError extends Error {
  constructor(
    readonly code: "too_many_products",
    message: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

export type CatalogStats = { searches: number; liveCalls: number; productsPriced: number };

/** Wraps any CatalogPort, counts calls and refuses bulk live lookups. Dock always talks to the catalog through this. */
export class MeteredCatalog implements CatalogPort {
  private counters: CatalogStats = { searches: 0, liveCalls: 0, productsPriced: 0 };

  constructor(
    private readonly inner: CatalogPort,
    private readonly maxIdsPerCall = MAX_LIVE_IDS_PER_CALL,
  ) {}

  async searchProducts(query: ProductQuery): Promise<Product[]> {
    this.counters.searches += 1;
    return this.inner.searchProducts(query);
  }

  async getLiveOffers(productIds: string[]): Promise<LiveOffer[]> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return [];
    if (ids.length > this.maxIdsPerCall) {
      throw new CatalogError(
        "too_many_products",
        `Live price/availability is limited to ${this.maxIdsPerCall} products per call; got ${ids.length}. Narrow the search first.`,
      );
    }
    this.counters.liveCalls += 1;
    this.counters.productsPriced += ids.length;
    return this.inner.getLiveOffers(ids);
  }

  stats(): CatalogStats {
    return { ...this.counters };
  }
}

type StockEntry = { unitPriceCents: number; availablePacks: number; leadDays: number };

/** In-memory stand-in for the partner's data and API. Delivery dates are relative to `now()`. */
export class InMemoryCatalog implements CatalogPort {
  private readonly products: Product[];
  private readonly stock: Map<string, StockEntry>;

  constructor(
    products: Product[],
    stock: Record<string, StockEntry>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.products = products.map((p) => ProductSchema.parse(p));
    this.stock = new Map(Object.entries(stock));
  }

  async searchProducts(query: ProductQuery): Promise<Product[]> {
    const tokens = normalize(query.text ?? "").split(" ").filter(Boolean);
    const hits = this.products.filter((p) => {
      if (query.ids && !query.ids.includes(p.id)) return false;
      if (query.category && p.category !== query.category) return false;
      if (query.attributes && !query.attributes.every((a) => p.attributes.includes(a))) return false;
      const haystack = normalize([p.name, p.brand, p.category, ...p.attributes].join(" "));
      return tokens.every((t) => haystack.includes(t));
    });
    return structuredClone(hits.slice(0, query.limit ?? 20));
  }

  async getLiveOffers(productIds: string[]): Promise<LiveOffer[]> {
    const offers: LiveOffer[] = [];
    for (const id of productIds) {
      const s = this.stock.get(id);
      if (!s) continue; // unknown or delisted: no offer
      offers.push({
        productId: id,
        unitPriceCents: s.unitPriceCents,
        availablePacks: s.availablePacks,
        deliveryDate: isoDate(addDays(this.now(), s.leadDays)),
      });
    }
    return offers;
  }

  /** For tests and demos: change price or stock, e.g. to simulate a sell-out between lookup and quote. */
  setStock(productId: string, patch: Partial<StockEntry>): void {
    const current = this.stock.get(productId);
    if (!current) throw new Error(`Unknown product ${productId}`);
    this.stock.set(productId, { ...current, ...patch });
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}
