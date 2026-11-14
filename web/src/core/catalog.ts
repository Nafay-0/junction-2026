import { z } from "zod";
import { addDaysIso, localNow } from "./kitchen";
import { NutritionSchema } from "./nutrition";

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
  deliveryReliability: z.number().min(0).max(1), // share of past deliveries on time (0 when unknown: see deliveryReliabilityKnown)
  carbonKgPerUnit: z.number().nonnegative(), // kg CO2e per unit (per litre, per kg) (0 when unknown: see carbonKnown)

  // ----- Optional detail, set by catalogues built from the partner's data (core/catalog/). Absent for the seed. -----
  source: z.enum(["seed", "valio"]).optional(),
  names: z.object({ en: z.string().optional(), fi: z.string().optional(), sv: z.string().optional() }).optional(),
  vendor: z.string().nullable().optional(),
  categoryCode: z.string().optional(), // the partner's numeric category; `category` is Dock's slug for it
  salesUnit: z.string().optional(), // the partner's unit code a pack is: KI (case), ST (piece), KG, ...
  baseUnit: z.string().optional(),
  lotSize: z.number().positive().optional(), // order quantity must be a multiple of this, in packs (0.01 = any)
  /** What one pack holds and how sure that is. When `certain` is false, `unit` is "pcs" and packSize counts base units. */
  packContent: z
    .object({
      perSalesUnit: z.object({ L: z.number().optional(), kg: z.number().optional() }),
      baseUnitsPerSalesUnit: z.number().nullable(),
      certain: z.boolean(),
      certainMeasures: z.array(z.enum(["L", "kg"])),
      issues: z.array(z.string()),
      label: z.string(),
    })
    .optional(),
  /** Allergen evidence. `declared: false` means no allergen data: every allergen is unknown, not absent. */
  allergenInfo: z
    .object({ declared: z.boolean(), contains: z.array(z.string()), mayContain: z.array(z.string()), freeFrom: z.array(z.string()) })
    .optional(),
  deliveryReliabilityKnown: z.boolean().optional(),
  carbonKnown: z.boolean().optional(),
  /** kg CO2e per kg, an average for the product group, not a measurement of this product. */
  carbonGroupAvgKgCo2ePerKg: z.number().nullable().optional(),
  temperatureClass: z.enum(["ambient", "chilled", "frozen"]).nullable().optional(),
  countryOfOrigin: z.string().nullable().optional(),
  substitutes: z.array(z.string()).optional(), // substitutes the partner lists for this product
  /** What kind of product the name makes it beyond its category ("coffee", "fermented", "portion"); empty when plain. */
  kinds: z.array(z.string()).optional(),

  // ----- Partner detail read since the data-depth index. Absent always means unknown, never "none" or "safe". -----
  /** The maker's nutrition declaration per 100 g or 100 ml (core/nutrition.ts). */
  nutrition: NutritionSchema.optional(),
  /** Deposits charged with one pack: material code and how many items (core/pricing.ts prices them). */
  deposits: z.array(z.object({ material: z.string(), quantity: z.number().positive() })).optional(),
  /** VAT rate from the product file's VAT class; the price service's rate, when asked, is the one that counts. */
  vatRatePct: z.number().nonnegative().optional(),
  /** What the maker writes about it, in English and Finnish where given, shortened in the index. */
  texts: z.record(z.enum(["ingredients", "storage", "usage", "disposal", "about"]), z.object({ en: z.string().optional(), fi: z.string().optional() })).optional(),
  mainIngredient: z.object({ names: z.object({ en: z.string().optional(), fi: z.string().optional(), sv: z.string().optional() }), pct: z.number().optional(), origins: z.array(z.object({ stage: z.string(), country: z.string() })) }).optional(),
  /** Every country of origin the data states (alpha-2). */
  origins: z.array(z.string()).optional(),
  fish: z.array(z.object({ species: z.string(), latin: z.string().optional(), production: z.enum(["aquaculture", "marine_fishery", "inland_fishery"]).optional(), methods: z.array(z.string()), areas: z.array(z.string()) })).optional(),
  storageTempC: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
});
export type Product = z.infer<typeof ProductSchema>;

/** Live price and stock for one product: what the partner's pricing/availability API returns. */
export type LiveOffer = {
  productId: string;
  unitPriceCents: number; // per pack
  availablePacks: number;
  deliveryDate: string; // YYYY-MM-DD, earliest possible delivery

  // ----- Optional detail from live adapters (absent for the seed). Explicit, never silent defaults. -----
  /** The delivery date that was asked for, when one was. */
  requestedDate?: string;
  /** True when the earliest delivery is after the requested date. */
  laterThanRequested?: boolean;
  /** False when the wholesaler does not know the stock (Terminal products report 999999): availablePacks is not a real figure. */
  stockKnown?: boolean;
  /** "Stock" (wholesaler holds it) or "Terminal" (shipped from the supplier's warehouse). */
  logisticModel?: string;
  salesUnit?: string;
  /** Order cut-off as the partner states it: order by then to get `deliveryDate`. */
  orderBy?: string;
  /** True when the cut-off has passed at lookup time (the date may then slip). */
  cutoffPassed?: boolean;
  priceValidFrom?: string;
  priceValidUntil?: string;
  unitPriceWithTaxCents?: number;
  taxRatePct?: number;
  comparisonPriceCents?: number; // per comparisonUnit
  comparisonUnit?: string; // KG or L
  listPriceCents?: number;
  netPrice?: boolean; // a customer-specific price was applied
  currency?: string;
  fetchedAt?: string;
  /** Set when a demo override replaced the live figures (see setStock). */
  simulated?: boolean;
  /** Ids of the signed claims Dock issued for this offer (see claims.ts). Set by the order flow, not by catalogues. */
  claims?: { price?: string; availability?: string; origin?: string };
};

/** Why a product has no usable live offer, or what to watch out for. */
export type LiveProblem =
  | "unknown_product" // not in the catalogue
  | "no_price" // the price API returned error: true
  | "price_not_valid" // the price's validity window does not cover today
  | "sales_block" // cannot be ordered right now
  | "not_deliverable" // no schedule line: cannot be delivered on any date
  | "out_of_stock" // a real stock figure of 0
  | "stock_unknown" // Terminal product: the quantity is not known
  | "later_than_requested" // earliest delivery after the requested date
  | "cutoff_passed" // the order cut-off for that date has passed
  | "unit_mismatch"; // availability given in another unit than the product's sales unit

/** Problems that leave no truthful offer to quote: a passed cut-off makes the stated delivery date untrue. */
export const NO_OFFER_PROBLEMS: ReadonlySet<LiveProblem> = new Set<LiveProblem>(["no_price", "price_not_valid", "sales_block", "not_deliverable", "unit_mismatch", "unknown_product", "cutoff_passed"]);

/** The offer a status carries when it can be quoted, else undefined. */
export function usableOffer(s: LiveStatus): LiveOffer | undefined {
  return s.offer && !s.problems.some((p) => NO_OFFER_PROBLEMS.has(p)) ? s.offer : undefined;
}

export type LiveStatus = {
  productId: string;
  requestedDate?: string;
  /** True when an order can be placed now: priced, not blocked, deliverable, stock not known to be zero. */
  orderable: boolean;
  problems: LiveProblem[];
  /** Present whenever there is a price and a delivery date, even if not orderable. */
  offer?: LiveOffer;
  message: string;
};

export type LiveOptions = {
  /** YYYY-MM-DD the buyer wants delivery on. Default: the earliest possible. */
  deliveryDate?: string;
  /**
   * The buying kitchen's customer number at the wholesaler, sent as the price service's `customer`: prices and
   * availability are customer-specific (the challenge's service ignores it). Catalogues without customers ignore it.
   */
  customer?: string;
};

export const ProductQuerySchema = z.object({
  text: z.string().optional(),
  category: z.string().optional(),
  attributes: z.array(z.string()).optional(),
  ids: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional(),
  // Optional, honoured by catalogues that have the data (the seed ignores them).
  forbiddenAllergens: z.array(z.string()).optional(), // unknown allergen data is excluded, not assumed safe
  minPackContent: z.object({ amount: z.number().positive(), unit: z.enum(["L", "kg"]) }).optional(),
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
  /** Offers for the products that have a price and a delivery date; others are left out (see getLiveStatus for why). */
  getLiveOffers(productIds: string[], options?: LiveOptions): Promise<LiveOffer[]>;
  /** One entry per requested product, saying whether it can be ordered and why not. Optional for implementations. */
  getLiveStatus?(productIds: string[], options?: LiveOptions): Promise<LiveStatus[]>;
}

export const MAX_LIVE_IDS_PER_CALL = 10;

export type CatalogErrorCode = "too_many_products" | "live_unavailable";

export class CatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
    /** live_unavailable: when the wholesaler's service says (or Dock judges) it is worth trying again, in seconds. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

export type CatalogStats = {
  searches: number;
  liveCalls: number;
  productsPriced: number;
  /** HTTP traffic to the partner, when the catalogue talks to a live API. */
  upstream?: { httpRequests: number; retries: number; cacheHits: number; failures: number };
};

/** Implemented by catalogues that call a remote API, so the meter can report real traffic. */
export interface UpstreamMetered {
  upstreamStats(): NonNullable<CatalogStats["upstream"]>;
}

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

  async getLiveOffers(productIds: string[], options?: LiveOptions): Promise<LiveOffer[]> {
    const ids = this.admit(productIds);
    if (ids.length === 0) return [];
    return options ? this.inner.getLiveOffers(ids, options) : this.inner.getLiveOffers(ids);
  }

  /** Same metering and cap as getLiveOffers. Falls back to deriving the status from offers if the inner catalogue cannot say more. */
  async getLiveStatus(productIds: string[], options?: LiveOptions): Promise<LiveStatus[]> {
    const ids = this.admit(productIds);
    if (ids.length === 0) return [];
    if (this.inner.getLiveStatus) return this.inner.getLiveStatus(ids, options);
    const offers = await this.inner.getLiveOffers(ids, options);
    return ids.map((id) => statusFromOffer(id, offers.find((o) => o.productId === id), options));
  }

  private admit(productIds: string[]): string[] {
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
    return ids;
  }

  stats(): CatalogStats {
    const upstream = (this.inner as Partial<UpstreamMetered>).upstreamStats?.();
    return upstream ? { ...this.counters, upstream } : { ...this.counters };
  }
}

/** The status the core derives for one product from a plain offer (or its absence). Exported so wrappers around a catalogue answer for every id asked, exactly as the core would. */
export function statusFromOffer(productId: string, offer: LiveOffer | undefined, options?: LiveOptions): LiveStatus {
  if (!offer) return { productId, requestedDate: options?.deliveryDate, orderable: false, problems: ["unknown_product"], message: `No live offer for ${productId}.` };
  const problems: LiveProblem[] = [];
  if (offer.availablePacks <= 0) problems.push("out_of_stock");
  if (options?.deliveryDate && offer.deliveryDate > options.deliveryDate) problems.push("later_than_requested");
  return {
    productId,
    requestedDate: options?.deliveryDate,
    orderable: offer.availablePacks > 0,
    problems,
    offer,
    message: problems.length ? `${productId}: ${problems.join(", ")}.` : `${productId}: ${offer.availablePacks} packs, delivery ${offer.deliveryDate}.`,
  };
}

/** `orderBy`: an order cut-off to state on the offer (tests); the seed states none. */
type StockEntry = { unitPriceCents: number; availablePacks: number; leadDays: number; orderBy?: string };

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

  async getLiveOffers(productIds: string[], options?: LiveOptions): Promise<LiveOffer[]> {
    const offers: LiveOffer[] = [];
    for (const id of productIds) {
      const s = this.stock.get(id);
      if (!s) continue; // unknown or delisted: no offer
      // Dock asks for the buyer's need-by date, which means "by": the earliest delivery is offered, and an
      // earlier date than that cannot be met.
      const deliveryDate = addDaysIso(localNow(this.now()).date, s.leadDays); // Helsinki days, like the gate
      const requestedDate = options?.deliveryDate;
      offers.push({ productId: id, unitPriceCents: s.unitPriceCents, availablePacks: s.availablePacks, deliveryDate, ...(s.orderBy ? { orderBy: s.orderBy } : {}), ...(requestedDate ? { requestedDate, laterThanRequested: deliveryDate > requestedDate } : {}) });
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

/**
 * An offer for a request that asked for an exact day: available earlier, it is delivered on that day (the wholesaler
 * delivers on the day asked, never before it can). Available only later, it stays later, and the day is missed.
 */
export function scheduledOn<T extends { deliveryDate: string }>(offer: T, day: string | undefined): T {
  return day && offer.deliveryDate < day ? { ...offer, deliveryDate: day } : offer;
}
