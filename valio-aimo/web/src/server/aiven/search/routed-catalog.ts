import type { CatalogPort, LiveOffer, LiveOptions, LiveStatus, Product, ProductQuery, UpstreamMetered } from "@/core/catalog";
import type { IndexedProduct } from "@/core/catalog/partner";
import { toDockProduct } from "@/core/catalog/product";
import type { SearchHit, SearchQuery } from "@/core/catalog/search";
import type { UpstreamStats } from "@/server/valio/live-client";
import { metrics } from "../metrics";
import { OpenSearchProductSearch } from "./opensearch-search";

/** What the router needs from the catalogue it wraps (ValioCatalog has all of it). */
export type RoutableCatalog = CatalogPort &
  Partial<UpstreamMetered> & {
    getProduct(id: string): IndexedProduct | undefined;
  };

export type ProductSearcher = { search(query: SearchQuery): Promise<SearchHit[]> };

export type SearchRoutedCatalogOptions = {
  /** Deadline for one OpenSearch answer before the in-process search answers instead. Default DOCK_SEARCH_TIMEOUT_MS or 400. */
  timeoutMs?: number;
  /** Consecutive failures that open the breaker. Default 3. */
  breakerThreshold?: number;
  /** How long the breaker stays open (OpenSearch skipped). Default 30 s. */
  breakerMs?: number;
  now?: () => number;
  /** Called after each search, for logs and tests. */
  onResult?: (r: { source: "opensearch" | "fallback"; ms: number; reason?: string }) => void;
};

export type SearchRoutingStats = { opensearch: number; fallback: number; consecutiveFailures: number; breakerOpenUntil: number | null; lastError?: string };

class Timeout extends Error {
  constructor(ms: number) {
    super(`no answer within ${ms} ms`);
    this.name = "Timeout";
  }
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Timeout(ms)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * The partner catalogue with product search answered by OpenSearch, and the in-process search as the fallback
 * when OpenSearch is slow, down, or returns an error. Live price and availability go to the wrapped catalogue
 * unchanged. Lookups by id never touch OpenSearch (the quote does them; the local index answers instantly).
 */
export class SearchRoutedCatalog implements CatalogPort, UpstreamMetered {
  private readonly timeoutMs: number;
  private readonly threshold: number;
  private readonly breakerMs: number;
  private readonly now: () => number;
  private readonly counts = { opensearch: 0, fallback: 0 };
  private failures = 0;
  private openUntil = 0;
  private lastError?: string;

  constructor(
    readonly inner: RoutableCatalog,
    private readonly searcher: ProductSearcher,
    private readonly opts: SearchRoutedCatalogOptions = {},
  ) {
    const envMs = Number.parseInt(process.env.DOCK_SEARCH_TIMEOUT_MS ?? "", 10);
    this.timeoutMs = opts.timeoutMs ?? (Number.isFinite(envMs) && envMs > 0 ? envMs : 400);
    this.threshold = opts.breakerThreshold ?? 3;
    this.breakerMs = opts.breakerMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  async searchProducts(query: ProductQuery): Promise<Product[]> {
    if (query.ids && !query.text && !query.category && !query.attributes?.length && !query.forbiddenAllergens?.length && !query.minPackContent) {
      return this.inner.searchProducts(query); // by id: keep the caller's order, no ranking
    }
    // Same mapping as ValioCatalog.searchProducts.
    const q: SearchQuery = {
      text: query.text,
      ids: query.ids,
      category: query.category,
      requiredClaims: query.attributes,
      forbiddenAllergens: query.forbiddenAllergens,
      minPackContent: query.minPackContent,
      limit: query.limit ?? 20,
    };
    const t0 = this.now();
    if (t0 < this.openUntil) return this.fallback(query, t0, "breaker open");
    try {
      const hits = await withDeadline(this.searcher.search(q), this.timeoutMs);
      this.failures = 0;
      this.counts.opensearch += 1;
      metrics.inc("search.opensearch");
      this.opts.onResult?.({ source: "opensearch", ms: this.now() - t0 });
      return hits.map((h) => toDockProduct(h.product));
    } catch (err) {
      this.failures += 1;
      this.lastError = err instanceof Timeout ? err.message : `${(err as { name?: string })?.name ?? "Error"}${(err as { meta?: { statusCode?: number } })?.meta?.statusCode ? ` HTTP ${(err as { meta: { statusCode: number } }).meta.statusCode}` : ""}`;
      if (this.failures >= this.threshold) this.openUntil = this.now() + this.breakerMs;
      return this.fallback(query, t0, this.lastError);
    }
  }

  private async fallback(query: ProductQuery, t0: number, reason: string): Promise<Product[]> {
    this.counts.fallback += 1;
    metrics.inc("search.fallback");
    const out = await this.inner.searchProducts(query);
    this.opts.onResult?.({ source: "fallback", ms: this.now() - t0, reason });
    return out;
  }

  getLiveOffers(productIds: string[], options?: LiveOptions): Promise<LiveOffer[]> {
    return options ? this.inner.getLiveOffers(productIds, options) : this.inner.getLiveOffers(productIds);
  }

  async getLiveStatus(productIds: string[], options?: LiveOptions): Promise<LiveStatus[]> {
    if (this.inner.getLiveStatus) return this.inner.getLiveStatus(productIds, options);
    throw new Error("The wrapped catalogue has no live status.");
  }

  upstreamStats(): UpstreamStats {
    return this.inner.upstreamStats?.() ?? { httpRequests: 0, retries: 0, cacheHits: 0, failures: 0 };
  }

  routingStats(): SearchRoutingStats {
    return { ...this.counts, consecutiveFailures: this.failures, breakerOpenUntil: this.openUntil > this.now() ? this.openUntil : null, lastError: this.lastError };
  }
}

const envValue = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

/** OpenSearch product search when DOCK_SEARCH=opensearch and OPENSEARCH_URL are set; otherwise undefined (in-process search). */
export function searchFromEnv(byId: (id: string) => IndexedProduct | undefined): OpenSearchProductSearch | undefined {
  const url = envValue("OPENSEARCH_URL");
  if (envValue("DOCK_SEARCH") !== "opensearch" || !url) return undefined;
  return new OpenSearchProductSearch({ url, byId, alias: envValue("DOCK_SEARCH_ALIAS") });
}
