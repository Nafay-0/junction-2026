import {
  CatalogError,
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
import { addDays, isoDate } from "@/core/util";
import { ValioApiError, helsinkiDate, validFromMs, validUntilMs, type UpstreamStats, type ValioLiveResult } from "./live-client";

/** What ValioCatalog needs from the live API. ValioLiveClient implements it; tests use a fake. */
export interface LiveLookup {
  lookup(productIds: string[], requestedDate: string): Promise<ValioLiveResult[]>;
  upstreamStats?(): UpstreamStats;
}

/** Terminal products always report this amount: the real stock is not known. */
export const TERMINAL_PLACEHOLDER_AMOUNT = 999999;

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
        results = await this.live.lookup(known, askDate);
      } catch (err) {
        if (err instanceof ValioApiError) throw new CatalogError("live_unavailable", `Live price/availability is unavailable right now (${err.code}): ${err.message}`);
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
    if (o.leadDays !== undefined) offer.deliveryDate = isoDate(addDays(now, o.leadDays));
    const problems: LiveProblem[] = status.problems.filter((p) => p !== "out_of_stock" && p !== "stock_unknown");
    if (offer.availablePacks <= 0) problems.push("out_of_stock");
    return { ...status, offer, problems, orderable: !problems.some((p) => BLOCKING.has(p)), message: `${status.message} (simulated)` };
  }
}

/** Problems that make a product impossible to order now. */
const BLOCKING = new Set<LiveProblem>(["no_price", "price_not_valid", "sales_block", "not_deliverable", "unit_mismatch", "unknown_product", "out_of_stock"]);
/** Problems that mean there is no truthful offer to hand to a quote at all. */
const NO_OFFER = new Set<LiveProblem>(["no_price", "price_not_valid", "sales_block", "not_deliverable", "unit_mismatch", "unknown_product"]);

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
  if (!avail) {
    problems.push("not_deliverable");
    notes.push("the availability API did not return it");
  } else {
    if (avail.salesBlock || avail.line?.salesBlock) {
      problems.push("sales_block");
      notes.push("sales block: cannot be ordered right now");
    }
    if (!avail.line) {
      problems.push("not_deliverable");
      notes.push("no schedule line: cannot be delivered on any date");
    }
  }

  const line = avail?.line;
  const terminal = avail?.logisticModel?.toLowerCase() === "terminal";
  if (line) {
    if (line.salesUnit && line.salesUnit !== product.salesUnit) {
      problems.push("unit_mismatch");
      notes.push(`availability given per ${line.salesUnit}, product sold per ${product.salesUnit}`);
    }
    if (terminal) {
      problems.push("stock_unknown");
      notes.push(`shipped from the supplier's warehouse: stock not known${line.availableAmount === TERMINAL_PLACEHOLDER_AMOUNT ? ` (${TERMINAL_PLACEHOLDER_AMOUNT} is a placeholder)` : ""}`);
    } else if (line.availableAmount <= 0) {
      problems.push("out_of_stock");
      notes.push("none in stock");
    }
    if (requested && line.availableDate > requested) {
      problems.push("later_than_requested");
      notes.push(`earliest delivery ${line.availableDate}, after the requested ${requested}`);
    }
  }
  const cutoff = avail?.closingTime ? cutoffPassed(avail.closingTime, avail.timeNow, now) : undefined;
  if (cutoff) {
    problems.push("cutoff_passed");
    notes.push(`order cut-off ${avail!.closingTime} has passed`);
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
      stockKnown: !terminal,
      logisticModel: avail?.logisticModel,
      salesUnit: line.salesUnit ?? product.salesUnit,
      orderBy: avail?.closingTime,
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
    ? `${id}: ${offer.stockKnown === false ? "stock unknown" : `${offer.availablePacks} ${offer.salesUnit} available`} at ${(offer.unitPriceCents / 100).toFixed(2)} ${offer.currency ?? "EUR"}/${offer.salesUnit}, delivery ${offer.deliveryDate}`
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
