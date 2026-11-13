import { describe, expect, it } from "vitest";
import { CatalogError, InMemoryCatalog, MeteredCatalog } from "./catalog";
import { SEED_PRODUCTS, SEED_STOCK } from "./seed";

const NOW = new Date("2026-11-13T10:00:00.000Z");
const make = () => new MeteredCatalog(new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, () => NOW));

describe("catalog", () => {
  it("seed has several lactose-free milks in different pack sizes", async () => {
    const hits = await make().searchProducts({ category: "milk", attributes: ["lactose_free"] });
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(new Set(hits.map((p) => p.packSize)).size).toBeGreaterThanOrEqual(3);
  });

  it("searches master data by free text, category and attributes", async () => {
    const c = make();
    const text = await c.searchProducts({ text: "lactose-free milk 10 L" });
    expect(text.map((p) => p.id)).toEqual(["VA-1010", "AR-2010"]);
    expect((await c.searchProducts({ text: "oat" })).map((p) => p.id)).toEqual(["PK-4001"]);
    expect((await c.searchProducts({ category: "milk", attributes: ["organic"] })).map((p) => p.id)).toEqual(["VA-1201"]);
    expect(await c.searchProducts({ ids: ["VA-1001", "nope"] })).toHaveLength(1);
    expect(await c.searchProducts({ category: "milk", limit: 2 })).toHaveLength(2);
  });

  it("returns live offers with delivery dates relative to now and skips unknown ids", async () => {
    const offers = await make().getLiveOffers(["VA-1010", "AR-2015", "unknown"]);
    expect(offers).toEqual([
      { productId: "VA-1010", unitPriceCents: 1290, availablePacks: 60, deliveryDate: "2026-11-14" },
      { productId: "AR-2015", unitPriceCents: 219, availablePacks: 300, deliveryDate: "2026-11-19" },
    ]);
  });

  it("counts live calls separately from master-data searches", async () => {
    const c = make();
    await c.searchProducts({ text: "milk" });
    await c.searchProducts({ text: "cream" });
    await c.getLiveOffers(["VA-1010", "AR-2010", "VA-1010"]);
    await c.getLiveOffers([]); // no-op, not counted
    expect(c.stats()).toEqual({ searches: 2, liveCalls: 1, productsPriced: 2 });
  });

  it("refuses bulk live lookups so the partner API is never scraped", async () => {
    const c = make();
    const all = SEED_PRODUCTS.map((p) => p.id);
    await expect(c.getLiveOffers(all)).rejects.toBeInstanceOf(CatalogError);
    expect(c.stats().liveCalls).toBe(0);
  });

  it("can simulate a stock change", async () => {
    const inner = new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, () => NOW);
    inner.setStock("VA-1010", { availablePacks: 0 });
    const [offer] = await inner.getLiveOffers(["VA-1010"]);
    expect(offer.availablePacks).toBe(0);
  });

  it("hands out copies, so callers cannot mutate master data", async () => {
    const c = make();
    const [p] = await c.searchProducts({ ids: ["VA-1010"] });
    p.attributes.push("organic");
    const [again] = await c.searchProducts({ ids: ["VA-1010"] });
    expect(again.attributes).not.toContain("organic");
  });
});
