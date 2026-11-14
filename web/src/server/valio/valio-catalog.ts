import {
  CatalogError,
  NO_OFFER_PROBLEMS,
  type CatalogPort,
  type LiveOffer,
  type LiveOptions,
  type LiveProblem,
  type LiveStatus,
  type Product,
  type ProductQuery,
  type UpstreamMetered,
} from "@/core/catalog";
import type { CatalogIndex, IndexedProduct } from "@/core/catalog/partner";
import { toDockProduct } from "@/core/catalog/product";
import { LexicalSearch, type SearchBackend, type SearchHit, type SearchQuery } from "@/core/catalog/search";
import { addDaysIso, localNow } from "@/core/kitchen";
import { ValioApiError, helsinkiDate, validFromMs, validUntilMs, type UpstreamStats, type ValioLiveResult } from "./live-client";

/** What ValioCatalog needs from the live API. ValioLiveClient implements it; tests use a fake. */
export interface LiveLookup {
  /** `customer`: the kitchen's customer number, sent as the API's `customer` (the client's own default when absent). */
  lookup(productIds: string[], requestedDate: string, customer?: string): Promise<ValioLiveResult[]>;
  upstreamStats?(): UpstreamStats;
}

/** Terminal products always report this amount: the real stock is not known. */
export const TERMINAL_PLACEHOLDER_AMOUNT = 999999;
/**
 * Amounts at or above this are placeholders, not stock: seen as 999999 on Terminal products and as 9999999999 on
 * Stock products in real responses. No food-service order line comes near it.
 */
export const IMPLAUSIBLE_AMOUNT = 999_999;

type StockOverride = { unitPriceCents?: number; availablePacks?: number; leadDays?: number };

/**
 * The partner's catalogue behind Dock's CatalogPort: master data from the local index (search freely), price and
 * availability from the live API (a short list at a time; MeteredCatalog enforces the cap and counts calls).
 */
export class ValioCatalog implements CatalogPort, UpstreamMetered {
  readonly index: CatalogIndex;
  private readonly byId: Map<string, IndexedProduct>;
  private readonly searchBackend: SearchBackend;
  private readonly now: () => Date;
  private readonly overrides = new Map<string, StockOverride>();

  constructor(
    index: CatalogIndex,
    private readonly live: LiveLookup,
    opts: { search?: SearchBackend; now?: () => Date } = {},
  ) {
    this.index = index;
    this.byId = new Map(index.products.map((p) => [p.id, p]));
    this.searchBackend = opts.search ?? new LexicalSearch(index.products);
    this.now = opts.now ?? (() => new Date());
  }

  upstreamStats(): UpstreamStats {
    return this.live.upstreamStats?.() ?? { httpRequests: 0, retries: 0, cacheHits: 0, failures: 0 };
  }

  getProduct(id: string): IndexedProduct | undefined {
    return this.byId.get(id);
  }

  /** Ranked hits with reasons and allergen evidence. Master data only, no live call. */
  search(query: SearchQuery): SearchHit[] {
    return this.searchBackend.search(query);
  }

  async searchProducts(query: ProductQuery): Promise<Product[]> {
    if (query.ids && !query.text && !query.category && !query.attributes?.length && !query.forbiddenAllergens?.length && !query.minPackContent) {
      // Lookup by id (the quote does this): keep the caller's order, no ranking.
      return query.ids
        .map((id) => this.byId.get(id))
        .filter((p): p is IndexedProduct => Boolean(p))
        .slice(0, query.limit ?? 100)
        .map(toDockProduct);
    }
    return this.search({
      text: query.text,
      ids: query.ids,
      category: query.category,
      requiredClaims: query.attributes,
      forbiddenAllergens: query.forbiddenAllergens,
      minPackContent: query.minPackContent,
      limit: query.limit ?? 20,
    }).map((h) => toDockProduct(h.product));
  }

  async getLiveOffers(productIds: string[], options?: LiveOptions): Promise<LiveOffer[]> {
    const statuses = await this.getLiveStatus(productIds, options);
    return statuses.filter((s) => s.offer && usable(s)).map((s) => s.offer!);
  }

  async getLiveStatus(productIds: string[], options?: LiveOptions): Promise<LiveStatus[]> {
    const ids = [...new Set(productIds)];
    const known = ids.filter((id) => this.byId.has(id));
    const requested = options?.deliveryDate;
    const now = this.now();
    // Without a date, ask for today: the API answers with the earliest possible date.
    const askDate = requested ?? helsinkiDate(now);
    let results: ValioLiveResult[] = [];
    if (known.length) {
      try {
        results = options?.customer ? await this.live.lookup(known, askDate, options.customer) : await this.live.lookup(known, askDate);
      } catch (err) {
        if (err instanceof ValioApiError) throw new CatalogError("live_unavailable", `${err.code === "timeout" || err.code === "rate_limited" ? "The wholesaler's live price and availability service is slow or busy right now" : "Live price/availability is unavailable right now"} (${err.code}): ${err.message}`, err.retryAfterSeconds ?? (err.code === "server_error" || err.code === "network" ? 30 : undefined));
        throw err;
      }
    }
    return ids.map((id) => {
      const product = this.byId.get(id);
      if (!product) return { productId: id, requestedDate: requested, orderable: false, problems: ["unknown_product"], message: `${id} is not in the catalogue.` };
      const status = interpret(product, results.find((r) => r.productId === id), requested, now);
      return this.applyOverride(status, now);
    });
  }

  /** Demo and test control, like InMemoryCatalog.setStock: pin price, stock or lead time. Offers then say `simulated: true`. */
  setStock(productId: string, patch: StockOverride): void {
    if (!this.byId.has(productId)) throw new Error(`Unknown product ${productId}`);
    this.overrides.set(productId, { ...this.overrides.get(productId), ...patch });
  }

  clearStockOverrides(): void {
    this.overrides.clear();
  }

  private applyOverride(status: LiveStatus, now: Date): LiveStatus {
    const o = this.overrides.get(status.productId);
    if (!o || !status.offer) return status;
    const offer: LiveOffer = { ...status.offer, simulated: true };
    if (o.unitPriceCents !== undefined) offer.unitPriceCents = o.unitPriceCents;
    if (o.availablePacks !== undefined) {
      offer.availablePacks = o.availablePacks;
      offer.stockKnown = true;
    }
    if (o.leadDays !== undefined) offer.deliveryDate = addDaysIso(localNow(now).date, o.leadDays); // Helsinki days
    const problems: LiveProblem[] = status.problems.filter((p) => p !== "out_of_stock" && p !== "stock_unknown");
    if (offer.availablePacks <= 0) problems.push("out_of_stock");
    return { ...status, offer, problems, orderable: !problems.some((p) => BLOCKING.has(p)), message: `${status.message} (simulated)` };
  }
}

/** Problems that make a product impossible to order now. */
const BLOCKING = new Set<LiveProblem>(["no_price", "price_not_valid", "sales_block", "not_deliverable", "unit_mismatch", "unknown_product", "out_of_stock", "cutoff_passed"]);
/** Problems that mean there is no truthful offer to hand to a quote at all (a passed cut-off included). */
const NO_OFFER = NO_OFFER_PROBLEMS;

function usable(s: LiveStatus): boolean {
  return !s.problems.some((p) => NO_OFFER.has(p));
}

/** Turn one raw live result into Dock's terms, naming every documented special case. */
export function interpret(product: IndexedProduct, r: ValioLiveResult | undefined, requested: string | undefined, now: Date): LiveStatus {
  const id = product.id;
  const problems: LiveProblem[] = [];
  const notes: string[] = [];
  const price = r?.price;
  const avail = r?.availability;

  if (!price || !price.ok) {
    problems.push("no_price");
    notes.push(price ? "the price API has no price for it" : "the price API did not return it");
  } else {
    const from = validFromMs(price.validFrom);
    const until = validUntilMs(price.validTo);
    if ((from !== undefined && from > now.getTime()) || (until !== undefined && until < now.getTime())) {
      problems.push("price_not_valid");
      notes.push(`price valid ${price.validFrom ?? "?"} to ${price.validTo ?? "?"}`);
    }
  }
  // The row the answer is about. closingTime is the cut-off for the availableDate of the answer's (first) row: with
  // several rows, it belongs to the earliest; a later row's day has no cut-off stated, and is used when the earliest
  // row's cut-off has passed or it has nothing to offer (Valio: "closingTime is the cut off related to availableDate").
  const rows = avail?.lines ?? (avail?.line ? [avail.line] : []);
  const firstCut = avail?.closingTime && rows[0] ? cutoffPassed(avail.closingTime, avail.timeNow, now) : undefined;
  const usableRow = (l: (typeof rows)[number]) => l.availableAmount > 0 && !l.salesBlock;
  const later = rows.slice(1).find(usableRow);
  const line = rows[0] && (firstCut || !usableRow(rows[0])) && later ? later : rows[0];
  const cutoffFor = line && line === rows[0] && avail?.closingTime ? rows[0].availableDate : undefined;

  if (!avail) {
    problems.push("not_deliverable");
    notes.push("the availability API did not return it");
  } else {
    if (avail.salesBlock || line?.salesBlock) {
      problems.push("sales_block");
      notes.push("sales block: cannot be ordered right now");
    }
    if (!line) {
      // "Empty = not available": no rows, or rows without an amount. Out of stock for the day asked.
      problems.push("out_of_stock");
      notes.push(`not available${requested ? ` for ${requested}` : ""}: the wholesaler's answer is empty`);
    }
  }

  // An amount of 999999 or more means the wholesaler does not know the stock (typically a Terminal product it does not
  // hold) and takes an order of any quantity: unknown, never short, never a reason to refuse.
  const stockUnknown = line !== undefined && line.availableAmount >= IMPLAUSIBLE_AMOUNT;
  if (line) {
    if (line.salesUnit && line.salesUnit !== product.salesUnit) {
      problems.push("unit_mismatch");
      notes.push(`availability given per ${line.salesUnit}, product sold per ${product.salesUnit}`);
    }
    if (stockUnknown) {
      problems.push("stock_unknown");
      notes.push("stock isn't reported for this one; the wholesaler takes the order");
    } else if (line.availableAmount <= 0) {
      problems.push("out_of_stock");
      notes.push(`none in stock for ${line.availableDate}`);
    }
    if (requested && line.availableDate > requested) {
      problems.push("later_than_requested");
      notes.push(`earliest delivery ${line.availableDate}, after the requested ${requested}`);
    }
  }
  const cutoff = cutoffFor ? firstCut : undefined;
  if (cutoff) {
    problems.push("cutoff_passed");
    notes.push(`order cut-off ${avail!.closingTime} for delivery ${cutoffFor} has passed: it cannot be ordered for ${cutoffFor} any more`);
  } else if (line && rows[0] && line !== rows[0]) {
    notes.push(`the earliest row (${rows[0].availableDate}) ${firstCut ? `is past its cut-off ${avail!.closingTime}` : "has nothing to offer"}; ${line.availableDate} has no cut-off stated`);
  }

  let offer: LiveOffer | undefined;
  if (price?.ok && line) {
    offer = {
      productId: id,
      unitPriceCents: price.valueCents,
      availablePacks: Math.max(0, Math.floor(line.availableAmount)),
      deliveryDate: line.availableDate,
      requestedDate: requested,
      laterThanRequested: requested ? line.availableDate > requested : undefined,
      stockKnown: !stockUnknown,
      logisticModel: avail?.logisticModel,
      salesUnit: line.salesUnit ?? product.salesUnit,
      ...(cutoffFor ? { orderBy: avail!.closingTime, orderByFor: cutoffFor } : {}),
      cutoffPassed: cutoff,
      priceValidFrom: price.validFrom,
      priceValidUntil: price.validTo,
      unitPriceWithTaxCents: price.valueWithTaxCents,
      taxRatePct: price.taxRatePct,
      comparisonPriceCents: price.comparisonPriceCents,
      comparisonUnit: price.comparisonUnit,
      listPriceCents: price.listPriceCents,
      netPrice: price.netPriceFound,
      currency: price.currency,
      fetchedAt: now.toISOString(),
    };
    for (const k of Object.keys(offer) as (keyof LiveOffer)[]) if (offer[k] === undefined) delete offer[k];
  }

  const orderable = !problems.some((p) => BLOCKING.has(p));
  const summary = offer
    ? `${id}: ${offer.stockKnown === false ? "stock not reported" : `${offer.availablePacks} ${offer.salesUnit} available`} at ${(offer.unitPriceCents / 100).toFixed(2)} ${offer.currency ?? "EUR"}/${offer.salesUnit}, delivery ${offer.deliveryDate}`
    : `${id}: no offer`;
  return { productId: id, requestedDate: requested, orderable, problems, offer, message: notes.length ? `${summary}; ${notes.join("; ")}.` : `${summary}.` };
}

/** True/false when the cut-off can be compared with the time of the answer; undefined when its format is not a full time stamp. */
function cutoffPassed(closingTime: string, timeNow: string | undefined, now: Date): boolean | undefined {
  // Times without an offset are Helsinki time; +03:00 errs towards an earlier cut-off.
  const parse = (s: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}+03:00`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(closingTime)) return undefined;
  const cut = parse(closingTime);
  const at = timeNow && /^\d{4}-\d{2}-\d{2}T/.test(timeNow) ? parse(timeNow) : now.getTime();
  return Number.isFinite(cut) && Number.isFinite(at) ? at > cut : undefined;
}
