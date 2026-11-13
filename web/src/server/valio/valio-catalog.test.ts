import { describe, expect, it } from "vitest";
import { InMemoryOutbox } from "@/core/approval";
import { CatalogError, MeteredCatalog } from "@/core/catalog";
import { buildCatalogIndex } from "@/core/catalog/partner";
import { packsFor } from "@/core/catalog/product";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV } from "@/core/catalog/test-data";
import { generateEd25519KeyPair } from "@/core/keys";
import { Ledger } from "@/core/ledger";
import { createTrustRegistry, signMandate } from "@/core/mandate";
import { InMemoryDockRepository, createDock } from "@/core/orders";
import { sampleMandate } from "@/core/test-fixtures";
import { fakeValioApi, type FakeScenario } from "./fake-api";
import { ValioLiveClient } from "./live-client";
import { ValioCatalog } from "./valio-catalog";

const NOW = new Date("2026-11-13T10:00:00.000Z"); // 12:00 in Helsinki
const index = buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV, NOW);

const SCENARIOS: Record<string, FakeScenario> = {
  "900001": { price: 25.8, amount: 30, date: "2026-11-16" }, // 30 cases = 600 l: partial for a 1,000 l order
  "900004": { price: 29.4, amount: 100, date: "2026-11-16" },
  "900003": { price: 18, logisticModel: "Terminal", date: "2026-11-17" },
  "900002": { price: "error", unit: "ST" },
  "900005": { price: 9, salesBlock: true },
  "900006": { price: 4, noLines: true },
  "900007": { price: 1.5, amount: 0, unit: "ST" },
  "900010": { price: 1.2, unit: "KI" }, // sold per ST, availability per KI
  "900008": { price: 3, validFrom: "2026-10-01", validTo: "2026-11-12", unit: "ST" },
  "900009": { price: 3, omit: "availability", unit: "ST" },
  "900016": { price: 1.9, unit: "ST", closingTime: "2026-11-13T11:00:00" },
};

function setup(scenarios = SCENARIOS, apiOpts: Parameters<typeof fakeValioApi>[1] = {}) {
  const api = fakeValioApi(scenarios, apiOpts);
  const live = new ValioLiveClient({ baseUrl: "https://valio.test", apiKey: "test-key", fetch: api.fetch, now: () => NOW, sleep: async () => {} });
  const valio = new ValioCatalog(index, live, { now: () => NOW });
  return { api, valio, metered: new MeteredCatalog(valio) };
}

describe("ValioCatalog: master data", () => {
  it("maps index records to Dock products without changing what the old fields mean", async () => {
    const { valio, api } = setup();
    const [p] = await valio.searchProducts({ ids: ["900001"] });
    expect(p).toMatchObject({
      id: "900001",
      category: "milk",
      unit: "L",
      packSize: 20, // litres per KI (the price is per KI)
      attributes: expect.arrayContaining(["lactose_free", "fat_1_5"]),
      allergens: ["milk"],
      certificates: ["hyvaa_suomesta"],
      deliveryReliability: 0.98,
      deliveryReliabilityKnown: true,
      salesUnit: "KI",
      categoryCode: "10400",
      source: "valio",
      packContent: { certain: true, label: "2 x 10 l = 20 l per KI" },
      substitutes: ["900002"],
    });
    expect(api.calls).toHaveLength(0); // master data never touches the live API
  });

  it("falls back to pieces when the pack content is not certain, and flags unknown figures", async () => {
    const { valio } = setup();
    const [p] = await valio.searchProducts({ ids: ["900015"] });
    expect(p).toMatchObject({ unit: "pcs", packSize: 1, packContent: { certain: false, issues: ["case_content_unclear"] }, deliveryReliability: 0, deliveryReliabilityKnown: false, carbonKnown: false });
    const [dill] = await valio.searchProducts({ ids: ["900017"] });
    expect(dill).toMatchObject({ allergens: [], allergenInfo: { declared: false } }); // empty list, but declared: false = unknown
  });

  it("works out carbon per unit only from known kilograms, from a group average", async () => {
    const { valio } = setup();
    const [milk] = await valio.searchProducts({ ids: ["900002"] });
    expect(milk).toMatchObject({ unit: "L", carbonGroupAvgKgCo2ePerKg: 1.15, carbonKnown: true, carbonKgPerUnit: 1.185 }); // 1.15 x 1.03 kg
    const [box] = await valio.searchProducts({ ids: ["900001"] });
    expect(box).toMatchObject({ carbonGroupAvgKgCo2ePerKg: 1.1, carbonKnown: false, carbonKgPerUnit: 0 }); // no weight known
  });

  it("searches with the Dock query shape, including the new filters", async () => {
    const { valio } = setup();
    const ids = async (q: Parameters<ValioCatalog["searchProducts"]>[0]) => (await valio.searchProducts(q)).map((p) => p.id);
    expect(await ids({ text: "laktoositon maito", limit: 5 })).toEqual(expect.arrayContaining(["900001", "900002", "900003", "900004", "900005"]));
    expect(await ids({ text: "milk", category: "milk", attributes: ["lactose_free"], minPackContent: { amount: 20, unit: "L" } })).toEqual(["900004", "900001"]);
    expect(await ids({ text: "granola", forbiddenAllergens: ["nuts"] })).toEqual([]);
    expect(await ids({ ids: ["900004", "900001", "nope"] })).toEqual(["900004", "900001"]); // caller's order
  });

  it("converts the buyer's litres into packs", async () => {
    const { valio } = setup();
    const [p] = await valio.searchProducts({ ids: ["900001"] });
    expect(packsFor(p, { amount: 1000, unit: "L" })).toMatchObject({ ok: true, salesUnits: 50, salesUnit: "KI" });
  });
});

describe("ValioCatalog: live price and availability", () => {
  it("maps every documented case to an explicit problem", async () => {
    const { valio, api } = setup();
    const ids = ["900001", "900003", "900002", "900005", "900006", "900007", "900010", "900008", "900009", "900016"];
    const statuses = await valio.getLiveStatus([...ids, "123456"], { deliveryDate: "2026-11-16" });
    const by = Object.fromEntries(statuses.map((s) => [s.productId, s]));
    expect(by["900001"]).toMatchObject({ orderable: true, problems: [], offer: { unitPriceCents: 2580, availablePacks: 30, deliveryDate: "2026-11-16", stockKnown: true, priceValidUntil: "2026-11-30", unitPriceWithTaxCents: 2928, taxRatePct: 13.5, orderBy: "2026-11-13T14:00:00", cutoffPassed: false } });
    expect(by["900003"]).toMatchObject({ orderable: true, problems: ["stock_unknown", "later_than_requested"], offer: { stockKnown: false, availablePacks: 999999, laterThanRequested: true, deliveryDate: "2026-11-17", logisticModel: "Terminal" } });
    expect(by["900002"]).toMatchObject({ orderable: false, problems: ["no_price"] });
    expect(by["900002"].offer).toBeUndefined();
    expect(by["900005"]).toMatchObject({ orderable: false, problems: ["sales_block"] });
    expect(by["900006"]).toMatchObject({ orderable: false, problems: ["not_deliverable"] });
    expect(by["900007"]).toMatchObject({ orderable: false, problems: ["out_of_stock"], offer: { availablePacks: 0 } });
    expect(by["900010"]).toMatchObject({ orderable: false, problems: ["unit_mismatch"] });
    expect(by["900008"]).toMatchObject({ orderable: false, problems: ["price_not_valid"] });
    expect(by["900009"]).toMatchObject({ orderable: false, problems: ["not_deliverable"] });
    expect(by["900016"]).toMatchObject({ orderable: true, problems: ["cutoff_passed"], offer: { cutoffPassed: true } });
    expect(by["123456"]).toMatchObject({ orderable: false, problems: ["unknown_product"] });
    for (const s of statuses) expect(s.message.length).toBeGreaterThan(5);
    // The unknown id was never sent to the partner.
    expect(api.calls.every((c) => !c.body!.products.includes("123456"))).toBe(true);
  });

  it("hands quotes only offers with a real price and delivery date", async () => {
    const { valio } = setup();
    const offers = await valio.getLiveOffers(["900001", "900003", "900002", "900005", "900006", "900007", "900010", "900008"], { deliveryDate: "2026-11-16" });
    expect(offers.map((o) => o.productId)).toEqual(["900001", "900003", "900007"]); // out of stock stays: 0 is a real figure
  });

  it("asks for today when no date is given and does not call that late", async () => {
    const { valio, api } = setup();
    const [s] = await valio.getLiveStatus(["900001"]);
    expect(api.calls[0].body!.requestedDate).toBe("2026-11-13");
    expect(s.problems).not.toContain("later_than_requested");
    expect(s.offer?.deliveryDate).toBe("2026-11-16");
  });

  it("is metered and capped through MeteredCatalog, with the real HTTP traffic", async () => {
    const { metered } = setup();
    await metered.searchProducts({ text: "milk" });
    await metered.getLiveOffers(["900001", "900004"], { deliveryDate: "2026-11-16" });
    await metered.getLiveStatus(["900001"], { deliveryDate: "2026-11-16" }); // served from cache
    expect(metered.stats()).toEqual({ searches: 1, liveCalls: 2, productsPriced: 3, upstream: { httpRequests: 2, retries: 0, cacheHits: 2, failures: 0 } });
    await expect(metered.getLiveOffers(index.products.map((p) => p.id))).rejects.toBeInstanceOf(CatalogError);
  });

  it("reports an outage as a catalogue error instead of inventing offers", async () => {
    const { valio } = setup(SCENARIOS, { status: 503 });
    await expect(valio.getLiveOffers(["900001"])).rejects.toMatchObject({ code: "live_unavailable" });
  });

  it("lets a demo pin stock, and says so", async () => {
    const { valio } = setup();
    valio.setStock("900004", { availablePacks: 5 });
    const [o] = await valio.getLiveOffers(["900004"], { deliveryDate: "2026-11-16" });
    expect(o).toMatchObject({ availablePacks: 5, simulated: true });
    valio.setStock("900003", { availablePacks: 0 });
    const [t] = await valio.getLiveStatus(["900003"], { deliveryDate: "2026-11-17" });
    expect(t).toMatchObject({ orderable: false, problems: ["out_of_stock"], offer: { stockKnown: true, simulated: true } });
    expect(() => valio.setStock("nope", {})).toThrow();
  });
});

describe("ValioCatalog in the order flow", () => {
  it("runs request -> lookup -> quote -> order on partner-shaped data", async () => {
    const { metered } = setup();
    const buyer = await generateEd25519KeyPair("buyer-1");
    const wholesaler = await generateEd25519KeyPair("wholesaler-1");
    const dock = createDock({
      catalog: metered,
      repo: new InMemoryDockRepository(),
      ledger: new Ledger(undefined, () => NOW),
      trustedIssuers: createTrustRegistry([{ kid: buyer.kid, orgId: "org_laakso", publicKey: buyer.publicKey }]),
      wholesalerKey: wholesaler,
      notifier: new InMemoryOutbox(),
      now: () => NOW,
    });
    const mandate = sampleMandate(NOW, { perOrderLimitCents: 200_000, weeklyBudgetCents: 500_000, delivery: { maxLeadDays: 5 } });
    const session = await dock.authenticate(await signMandate(mandate, buyer), mandate.agentId);
    const req = await dock.openRequest(session, { text: "1,000 litres of lactose-free milk by Monday", neededBy: "2026-11-16" });
    const found = await dock.searchProducts(session, { requestId: req.requestId, text: "lactose-free milk", category: "milk", attributes: ["lactose_free"], limit: 3 });
    expect(found[0].packContent?.certain).toBe(true);
    const offers = await dock.checkAvailability(session, { requestId: req.requestId, productIds: ["900001", "900004"] });
    expect(offers.map((o) => o.availablePacks)).toEqual([30, 100]);
    // 30 cases of 20 l = 600 l of the first choice, the remaining 400 l as 20 cases of 21 l (420 l).
    const { quote, policyPreview } = await dock.requestQuote(session, {
      requestId: req.requestId,
      lines: [
        { productId: "900001", quantity: 30 },
        { productId: "900004", quantity: 20, substituteFor: "900001" },
      ],
    });
    expect(quote.lines.map((l) => [l.productId, l.unit, l.packSize, l.unitPriceCents])).toEqual([
      ["900001", "L", 20, 2580],
      ["900004", "L", 21, 2940],
    ]);
    expect(quote.totalCents).toBe(30 * 2580 + 20 * 2940);
    // 29.40/21 l = 1.40 per litre vs 25.80/20 l = 1.29: +8.5 %, inside the 10 % tolerance, so a human signs the substitute off.
    expect(policyPreview.outcome).toBe("needs_human_approval");
  });
});
