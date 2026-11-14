import { beforeEach, describe, expect, it } from "vitest";
import { buildCatalogIndex } from "@/core/catalog/partner";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV } from "@/core/catalog/test-data";
import type { SearchHit, SearchQuery } from "@/core/catalog/search";
import { ValioCatalog } from "@/server/valio/valio-catalog";
import { metrics } from "../metrics";
import { facetsOf, toDoc } from "./mapping";
import { OpenSearchProductSearch, buildSearchBody, toHits, type SearchClient } from "./opensearch-search";
import { SearchRoutedCatalog, searchFromEnv, type ProductSearcher } from "./routed-catalog";

const index = buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV);
const byIdMap = new Map(index.products.map((p) => [p.id, p]));
const byId = (id: string) => byIdMap.get(id);
const json = (x: unknown) => JSON.stringify(x);

/** A response with these ids in this order and descending scores. */
const response = (ids: string[]) => ({
  hits: { hits: ids.map((id, i) => ({ _id: id, _score: 10 - i, _source: { id, facets: byId(id) ? toDoc(byId(id)!).facets : [], categoryCode: byId(id)?.categoryCode } })) },
});

describe("mapping", () => {
  it("keeps allergen evidence distinct: contains, free from, and unknown (not declared)", () => {
    const oat = toDoc(byId("900016")!);
    expect(oat.allergens.declared).toBe(true);
    expect(oat.allergens.contains.length).toBeGreaterThan(0);
    expect(oat.allergens.free_from.length).toBeGreaterThan(0);
    const dill = toDoc(byId("900017")!);
    expect(dill.allergens).toEqual({ declared: false, contains: [], may_contain: [], free_from: [] });
  });

  it("tags kinds of product that share words with others", () => {
    expect(facetsOf("Tunturi coffee milk 1 l lactose free")).toContain("coffee");
    expect(facetsOf("Tunturi kahvimaito 1 l")).toContain("coffee");
    expect(facetsOf("Kuusi lactose free semi skimmed milk 1 l")).toEqual([]);
  });
});

describe("buildSearchBody", () => {
  it("turns claims in the text and required claims into hard filters", () => {
    const b = buildSearchBody({ text: "laktoositon maito", requiredClaims: ["organic"] });
    expect(b.claims).toEqual(["organic", "lactose_free"]);
    expect(json(b.body)).toContain(json({ term: { claims: "lactose_free" } }));
    expect(json(b.body)).toContain(json({ term: { claims: "organic" } }));
    expect(b.parsed.terms).toEqual(["maito"]);
  });

  it("forbidden allergens: never contains or may contain, and unknown is excluded", () => {
    const b = buildSearchBody({ text: "dairy free dessert", forbiddenAllergens: ["nuts"] });
    expect(b.forbidden).toEqual(["nuts", "milk"]);
    const s = json(b.body);
    for (const a of ["nuts", "milk"]) {
      expect(s).toContain(json({ term: { "allergens.contains": a } }));
      expect(s).toContain(json({ term: { "allergens.may_contain": a } }));
      expect(s).toContain(json({ bool: { should: [{ term: { "allergens.free_from": a } }, { term: { "allergens.declared": true } }], minimum_should_match: 1 } }));
    }
    const strict = json(buildSearchBody({ forbiddenAllergens: ["milk"], allergenProof: "free_from" }).body);
    expect(strict).toContain(json({ term: { "allergens.free_from": "milk" } }));
    expect(strict).not.toContain("allergens.declared");
  });

  it("category slugs map to codes; an unknown slug matches nothing", () => {
    expect(json(buildSearchBody({ category: "milk" }).body)).toContain(json({ terms: { categoryCode: ["10400"] } }));
    expect(json(buildSearchBody({ category: "no_such_category" }).body)).toContain(json({ match_none: {} }));
  });

  it("pack content filters on a certain measure", () => {
    const s = json(buildSearchBody({ minPackContent: { amount: 10, unit: "L" } }).body);
    expect(s).toContain(json({ term: { "pack.certainMeasures": "L" } }));
    expect(s).toContain(json({ range: { "pack.L": { gte: 10 } } }));
  });

  it("ranks down kinds of product not asked for, but not the ones named", () => {
    const plain = json(buildSearchBody({ text: "milk" }).body);
    expect(plain).toContain('"boosting"');
    expect(plain).toMatch(/"facets":\[[^\]]*"coffee"/);
    const coffee = buildSearchBody({ text: "coffee milk" }).body as { query: { boosting: { negative: { terms: { facets: string[] } } } } };
    expect(coffee.query.boosting.negative.terms.facets).not.toContain("coffee");
  });

  it("clamps the limit and needs every term unless told otherwise", () => {
    expect(buildSearchBody({ text: "x", limit: 1000 }).limit).toBe(100);
    expect(buildSearchBody({ limit: 0 }).limit).toBe(1);
    const all = buildSearchBody({ text: "oat drink barista" }).body as { query: { boosting: { positive: { bool: { must: [{ bool: { minimum_should_match: number } }] } } } } };
    expect(all.query.boosting.positive.bool.must[0].bool.minimum_should_match).toBe(3);
    const some = buildSearchBody({ text: "oat drink barista" }, 1).body as typeof all;
    expect(some.query.boosting.positive.bool.must[0].bool.minimum_should_match).toBe(2);
  });

  it("without text, matches everything that passes the filters", () => {
    expect(json(buildSearchBody({ category: "milk" }).body)).toContain('"match_all"');
  });
});

describe("toHits", () => {
  it("returns the local product objects, skips ids it does not know, and gives allergen evidence", () => {
    const q: SearchQuery = { text: "oat drink", forbiddenAllergens: ["milk"] };
    const built = buildSearchBody(q);
    const hits = toHits(response(["900016", "999999"]), built, q, byId);
    expect(hits).toHaveLength(1);
    expect(hits[0].product).toBe(byId("900016"));
    expect(hits[0].allergens).toEqual({ milk: "free_from" });
    expect(hits[0].why).toContain("ranked by OpenSearch");
  });

  it("explains a matched pack size and names the facets that cost rank", () => {
    const q: SearchQuery = { text: "milk 10 l" };
    const hits = toHits(response(["900001", "900007"]), buildSearchBody(q), q, byId);
    expect(hits.find((h) => h.product.id === "900001")!.why).toContain("pack size 10 L as asked");
    expect(hits.find((h) => h.product.id === "900007")!.why.join(" ")).toContain("coffee not asked for");
  });
});

function fakeClient(answers: Array<string[] | Error>): SearchClient & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    async search(params) {
      calls.push(params.body);
      const a = answers.shift() ?? [];
      if (a instanceof Error) throw a;
      return { body: response(a) };
    },
    async count() {
      return { body: { count: 20 } };
    },
  };
}

describe("OpenSearchProductSearch", () => {
  it("retries with fewer required terms when nothing matches every term, like the in-process search", async () => {
    const client = fakeClient([[], ["900016"]]);
    const os = new OpenSearchProductSearch({ client, byId });
    const hits = await os.search({ text: "pelto oat juice" });
    expect(hits.map((h) => h.product.id)).toEqual(["900016"]);
    expect(client.calls).toHaveLength(2);
  });

  it("health reports the document count and never throws", async () => {
    expect(await new OpenSearchProductSearch({ client: fakeClient([]), byId }).health()).toMatchObject({ ok: true, detail: "20 products in dock-products" });
    const broken: SearchClient = { search: async () => ({ body: {} }), count: async () => Promise.reject(Object.assign(new Error("x"), { meta: { statusCode: 404 } })) };
    expect(await new OpenSearchProductSearch({ client: broken, byId }).health()).toMatchObject({ ok: false, detail: expect.stringContaining("does not exist") });
  });
});

describe("SearchRoutedCatalog", () => {
  const live = { lookup: async () => [] };
  const inner = new ValioCatalog(index, live);
  let clock = 0;
  const now = () => clock;
  beforeEach(() => {
    metrics.reset();
    clock = 1_000_000;
  });

  const hitsFor = (ids: string[]): SearchHit[] => ids.map((id) => ({ product: byId(id)!, score: 1, why: [] }));

  it("answers from OpenSearch, mapping the query as ValioCatalog does", async () => {
    const seen: SearchQuery[] = [];
    const searcher: ProductSearcher = { search: async (q) => (seen.push(q), hitsFor(["900002"])) };
    const cat = new SearchRoutedCatalog(inner, searcher, { now });
    const products = await cat.searchProducts({ text: "milk", attributes: ["lactose_free"], category: "milk" });
    expect(products.map((p) => p.id)).toEqual(["900002"]);
    expect(seen[0]).toEqual({ text: "milk", ids: undefined, category: "milk", requiredClaims: ["lactose_free"], forbiddenAllergens: undefined, minPackContent: undefined, limit: 20 });
    expect(metrics.get("search.opensearch")).toBe(1);
  });

  it("lookups by id never touch OpenSearch", async () => {
    let called = false;
    const cat = new SearchRoutedCatalog(inner, { search: async () => ((called = true), []) }, { now });
    expect((await cat.searchProducts({ ids: ["900003", "900001"] })).map((p) => p.id)).toEqual(["900003", "900001"]);
    expect(called).toBe(false);
  });

  it("falls back to the in-process search on an error and on a timeout", async () => {
    const expected = (await inner.searchProducts({ text: "laktoositon maito" })).map((p) => p.id);
    const failing = new SearchRoutedCatalog(inner, { search: async () => Promise.reject(new Error("connection refused")) }, { now });
    expect((await failing.searchProducts({ text: "laktoositon maito" })).map((p) => p.id)).toEqual(expected);
    const slow = new SearchRoutedCatalog(inner, { search: () => new Promise((r) => setTimeout(() => r(hitsFor(["900011"])), 200)) }, { now, timeoutMs: 20 });
    expect((await slow.searchProducts({ text: "laktoositon maito" })).map((p) => p.id)).toEqual(expected);
    expect(slow.routingStats().lastError).toBe("no answer within 20 ms");
    expect(metrics.get("search.fallback")).toBe(2);
  });

  it("opens the breaker after consecutive failures, then tries again after the pause", async () => {
    let calls = 0;
    let fail = true;
    const searcher: ProductSearcher = { search: async () => (calls++, fail ? Promise.reject(new Error("down")) : hitsFor(["900002"])) };
    const cat = new SearchRoutedCatalog(inner, searcher, { now, breakerThreshold: 3, breakerMs: 30_000 });
    for (let i = 0; i < 5; i++) await cat.searchProducts({ text: "milk" });
    expect(calls).toBe(3); // the 4th and 5th skipped OpenSearch
    expect(cat.routingStats().breakerOpenUntil).toBe(1_030_000);
    fail = false;
    clock += 30_001;
    expect((await cat.searchProducts({ text: "milk" })).map((p) => p.id)).toEqual(["900002"]);
    expect(cat.routingStats()).toMatchObject({ consecutiveFailures: 0, breakerOpenUntil: null, opensearch: 1, fallback: 5 });
  });

  it("delegates live price and availability to the wrapped catalogue", async () => {
    const cat = new SearchRoutedCatalog(inner, { search: async () => [] }, { now });
    expect(await cat.getLiveStatus(["nope"])).toEqual(await inner.getLiveStatus(["nope"]));
    expect(cat.upstreamStats()).toEqual(inner.upstreamStats());
  });
});

describe("searchFromEnv", () => {
  it("is off unless DOCK_SEARCH=opensearch and OPENSEARCH_URL are both set", () => {
    const saved = { s: process.env.DOCK_SEARCH, u: process.env.OPENSEARCH_URL };
    try {
      process.env.DOCK_SEARCH = "";
      process.env.OPENSEARCH_URL = "https://user:pw@example.invalid:1";
      expect(searchFromEnv(byId)).toBeUndefined();
      process.env.DOCK_SEARCH = "opensearch";
      expect(searchFromEnv(byId)).toBeInstanceOf(OpenSearchProductSearch);
      process.env.OPENSEARCH_URL = "";
      expect(searchFromEnv(byId)).toBeUndefined();
    } finally {
      process.env.DOCK_SEARCH = saved.s;
      process.env.OPENSEARCH_URL = saved.u;
      if (saved.s === undefined) delete process.env.DOCK_SEARCH;
      if (saved.u === undefined) delete process.env.OPENSEARCH_URL;
    }
  });
});

