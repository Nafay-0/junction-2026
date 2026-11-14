import type { UpstreamStats, ValioLiveResult } from "@/server/valio/live-client";
import type { LiveLookup } from "@/server/valio/valio-catalog";

/**
 * The hook `buildCatalog` puts in front of the partner's live API: a LiveLookup that passes calls straight through
 * until `selectAdapters` plugs the Valkey cache in (DOCK_CACHE=valkey). Kept tiny and dependency-free so the
 * catalogue code does not need to know about Valkey, and the catalogue object stays the same object.
 */
export class LiveCacheSlot implements LiveLookup {
  private target: LiveLookup;

  constructor(readonly inner: LiveLookup) {
    this.target = inner;
  }

  /** Put a wrapper (the cache) between the catalogue and the partner. Idempotent per slot: the last one wins. */
  attach(wrap: (inner: LiveLookup) => LiveLookup): void {
    this.target = wrap(this.inner);
  }

  get attached(): boolean {
    return this.target !== this.inner;
  }

  lookup(productIds: string[], requestedDate: string): Promise<ValioLiveResult[]> {
    return this.target.lookup(productIds, requestedDate);
  }

  upstreamStats(): UpstreamStats {
    return this.target.upstreamStats?.() ?? this.inner.upstreamStats?.() ?? { httpRequests: 0, retries: 0, cacheHits: 0, failures: 0 };
  }
}

/** Which slot belongs to which catalogue object (set by buildCatalog, read by selectAdapters). On globalThis so
 * every route bundle sees the same map. */
const g = globalThis as typeof globalThis & { __dockLiveCacheSlots?: WeakMap<object, LiveCacheSlot> };
export const liveCacheSlots: WeakMap<object, LiveCacheSlot> = (g.__dockLiveCacheSlots ??= new WeakMap());
