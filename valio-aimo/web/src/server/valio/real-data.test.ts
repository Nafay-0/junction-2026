// Checks against the real partner index and the live API. Both are optional:
// - the index tests run only when `pnpm index:build` has been run on this machine (the data is never in the repo);
// - the live test runs only with VALIO_LIVE=1 and a key (from the shell or web/.env.local), and prices three
//   products once: `VALIO_LIVE=1 pnpm vitest run src/server/valio/real-data.test.ts`. A plain `pnpm test` never calls the partner.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { amountToSalesUnits } from "@/core/catalog/pack";
import { LexicalSearch } from "@/core/catalog/search";
import { defaultIndexPath, indexExists, loadCatalogIndex } from "./index-store";
import { ValioLiveClient, helsinkiDate } from "./live-client";
import { ValioCatalog } from "./valio-catalog";

const hasIndex = indexExists(defaultIndexPath());
const loaded = hasIndex ? loadCatalogIndex()! : null;

describe.skipIf(!hasIndex)("real catalogue index (skipped without pnpm index:build)", () => {
  const products = loaded?.index.products ?? [];
  const search = new LexicalSearch(products);
  const lfMilks = products.filter((p) => p.categoryCode === "10400" && p.claims.includes("lactose_free"));

  it("loads fast and holds the whole catalogue", () => {
    expect(products.length).toBeGreaterThan(17_000);
    // About 200 ms on an idle laptop; the bound only catches a load that has gone badly wrong, and leaves room for a
    // machine that several engineers are building on at once (it measured 1.6 s at a load average of 50).
    expect(loaded!.loadMs).toBeLessThan(10_000);
  });

  it("converts nearly every lactose-free milk from litres cleanly", () => {
    expect(lfMilks.length).toBeGreaterThanOrEqual(30);
    const clean = lfMilks.filter((p) => amountToSalesUnits({ ...p.pack, lotSize: p.lotSize }, { amount: 1000, unit: "L" }).ok);
    expect(clean.length / lfMilks.length).toBeGreaterThan(0.9);
  });

  it("gets the partner's own example right: the 10 l box sold in cases of two", () => {
    const box = products.find((p) => p.id === "463038")!;
    expect(box.pack).toMatchObject({ salesUnit: "KI", perSalesUnit: { L: 20 }, certain: true });
    expect(amountToSalesUnits({ ...box.pack, lotSize: box.lotSize }, { amount: 1000, unit: "L" })).toMatchObject({ ok: true, salesUnits: 50 });
  });

  it.each(["lactose-free milk", "laktoositon maito", "laktosfri mjölk"])("'%s' returns lactose-free milks, not cream, yoghurt or portions", (text) => {
    const hits = search.search({ text, limit: 10 });
    expect(hits).toHaveLength(10);
    for (const h of hits) {
      expect(h.product.claims).toContain("lactose_free");
      expect(["10401", "10412"]).not.toContain(h.product.categoryCode);
    }
    expect(hits.filter((h) => h.product.categoryCode === "10400").length).toBeGreaterThanOrEqual(9);
  });

  it("never marks a product without allergen data as free of anything it was not declared free of", () => {
    for (const p of products.filter((x) => !x.allergens.declared)) {
      expect(p.allergens.contains).toEqual([]);
      for (const a of p.allergens.freeFrom) expect(["gluten", "lactose", "milk", "eggs", "fish", "crustaceans", "molluscs", "soy", "wheat"]).toContain(a); // only from claims
    }
  });
});

if (process.env.VALIO_LIVE === "1" && existsSync(".env.local")) process.loadEnvFile(".env.local");
const apiKey = process.env.VALIO_LIVE === "1" ? process.env.VALIO_API_KEY?.trim() : undefined;

describe.skipIf(!apiKey || !hasIndex)("live partner API (opt-in: VALIO_LIVE=1, a key and the index)", () => {
  it("prices three lactose-free milks", { timeout: 30_000 }, async () => {
    const live = new ValioLiveClient({ baseUrl: process.env.VALIO_API_BASE?.trim() || "https://junction26.valioaimo.fi", apiKey: apiKey! });
    const valio = new ValioCatalog(loaded!.index, live);
    const ids = valio.search({ text: "lactose-free milk", category: "milk", limit: 3 }).map((h) => h.product.id);
    const statuses = await valio.getLiveStatus(ids, { deliveryDate: helsinkiDate(new Date(Date.now() + 3 * 86_400_000)) });
    expect(statuses).toHaveLength(3);
    for (const s of statuses) {
      expect(s.message).toMatch(new RegExp(s.productId));
      console.log(`[live] ${s.orderable ? "orderable" : "not orderable"} ${s.problems.join(",") || "-"} | ${s.message}`);
      if (s.offer) expect(s.offer.unitPriceCents).toBeGreaterThan(0);
      if (s.offer && s.offer.availablePacks >= 999_999) expect(s.offer.stockKnown).toBe(false); // placeholders never count as stock
    }
    expect(live.upstreamStats().httpRequests).toBeLessThanOrEqual(4);
  });
});
