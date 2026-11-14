import type { Product } from "@/core/catalog";
import type { ValioLiveResult } from "@/server/valio/live-client";
import type { LiveLookup } from "@/server/valio/valio-catalog";
import { playingNow } from "./clock";

/**
 * The partner's live price and availability while a sample beat plays: never a call to the partner. A beat that
 * happens "three days ago" cannot ask the live API about that day, and the seed must not spend the shared allowance,
 * so a sample beat gets an answer in the partner's own format, from the price this server last saw live for the
 * product (primed once with one batched call, `primePrices`) or a plausible food-service level, stock enough for a
 * kitchen, deliverable on the day asked. ValioCatalog marks every offer built from it `simulated: true` and its
 * message "(sample, not live)", so every claim signed from it says so. Outside a sample beat every call goes
 * through untouched.
 */
const CENTS_PER_UNIT: Record<string, number> = { milk: 125, cream: 420, plant_drink: 210, yoghurt: 310, quark: 380, cheese: 1250, butter: 900 };

const g = globalThis as typeof globalThis & { __dockSamplePrices?: Map<string, number> };
/** The last live price per product this process saw (cents per sales unit), for sample answers. */
export const knownPrices = (g.__dockSamplePrices ??= new Map());

export function plausiblePriceCents(p: Pick<Product, "category" | "packSize">): number {
  return Math.max(50, Math.round((CENTS_PER_UNIT[p.category] ?? 300) * Math.max(0.1, p.packSize)));
}

export class SampleAwareLive implements LiveLookup {
  constructor(
    private readonly inner: LiveLookup,
    private readonly product: (id: string) => Product | undefined,
  ) {}

  async lookup(productIds: string[], requestedDate: string, customer?: string): Promise<ValioLiveResult[]> {
    if (!playingNow()) {
      const out = customer ? await this.inner.lookup(productIds, requestedDate, customer) : await this.inner.lookup(productIds, requestedDate);
      for (const r of out) if (r.price?.ok) knownPrices.set(r.productId, r.price.valueCents);
      return out;
    }
    return productIds.map((id): ValioLiveResult => {
      const p = this.product(id);
      const cents = knownPrices.get(id) ?? (p ? plausiblePriceCents(p) : 300);
      return {
        productId: id,
        requestedDate,
        price: { ok: true, valueCents: cents, currency: "EUR" },
        availability: { salesBlock: false, line: { availableAmount: 400, availableDate: requestedDate, ...(p?.salesUnit ? { salesUnit: p.salesUnit } : {}), salesBlock: false } },
      };
    });
  }

  upstreamStats() {
    return this.inner.upstreamStats?.() ?? { httpRequests: 0, retries: 0, cacheHits: 0, failures: 0 };
  }
}

/** For ValioCatalog: the label its offers carry while a sample beat plays. */
export const sampleLiveLabel = (): string | undefined => (playingNow() ? "sample, not live" : undefined);
