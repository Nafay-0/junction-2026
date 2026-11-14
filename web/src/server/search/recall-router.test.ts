import { describe, expect, it } from "vitest";
import { buildRecallSearches, cosineOf, recallFilter, toExternalLists, toRecallDoc } from "@/server/aiven/search/opensearch-recall";
import { KnowledgeMap } from "@/server/knowledge/map";
import { testKnowledge, testProducts } from "@/server/knowledge/test-catalogue";
import { SearchIndex, fuseLists, type ExternalLists, type Understood } from "./recall";
import { RecallRouter, type ListsSource } from "./recall-router";
import { searchFacts } from "./telemetry";
import { ProductVectors, quantise } from "./vectors";

// Synthetic catalogue and map (knowledge/test-catalogue.ts), synthetic 4-dimensional vectors: no partner data, no network.
const products = testProducts();
const map = new KnowledgeMap(products, testKnowledge());
const DIM = 4;
const vecFor = (i: number) => Float32Array.from([Math.cos(i), Math.sin(i), Math.cos(2 * i) * 0.5, 0.3]);
const { data, scale } = quantise(products.map((_, i) => vecFor(i)), DIM);
const meta = { format: "dock-search-vectors", version: 1, model: "test", dim: DIM, builtAt: "2026-11-14T00:00:00Z", recipe: "test", count: products.length, tokens: 0, costUsd: 0 } as const;
const vectors = new ProductVectors(meta, products.map((p) => p.id), data, scale);
const unit = (v: Float32Array) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

/** The lists the in-process sources would give, as another backend would hand them over: the comparability property. */
function sameListsAs(ix: SearchIndex, u: Understood, opts: { size: number; queryVector?: Float32Array }, allow: (id: string) => boolean): ExternalLists {
  const plan = ix.recallPlan(u, opts);
  const all = () => true;
  return {
    ...(plan.lexical ? { lexical: ix.keywordRank(plan.lexical.terms, "and", all, 200).filter(allow) } : {}),
    ...(plan.typo ? { typo: ix.keywordRank(plan.typo.terms, "and", all, 200).filter(allow) } : {}),
    ...(plan.words ? { words: ix.keywordRank(plan.words.terms, "or", all, 200).filter(allow) } : {}),
    ...(plan.vectors && opts.queryVector ? { vectors: ix.vectors!.nearest(opts.queryVector, 200).filter((n) => allow(n.id)) } : {}),
  };
}

describe("recall fusion is one function for both backends", () => {
  it("fuses by reciprocal rank with each source's quota first", () => {
    const out = fuseLists(
      [
        { source: "lexical", weight: 1, ids: ["a", "b", "c"] },
        { source: "vectors", weight: 1, ids: ["d", "e", "a"] },
      ],
      { uses: [] },
      3,
      null,
    );
    // a is in both lists (1/60 + 1/62): first. Quotas (lexical 15 %, vectors 25 % of 3: one each) keep d.
    expect(out.map((c) => c.id)).toEqual(["a", "d", "b"]);
    expect(out[0].sources).toEqual(["lexical", "vectors"]);
    expect(out[0].score).toBeCloseTo(1 / 60 + 1 / 62, 10);
  });

  it("gives the same candidates whether the lists came from memory or from outside", () => {
    const ix = new SearchIndex(products, map, vectors);
    for (const text of ["whipping cream", "lactose free milk for coffee", "pizza cheese", "vispikerma"]) {
      const u = ix.understand(text);
      const filter = ix.hardFilter(u);
      const queryVector = unit(vecFor(3));
      const opts = { size: 10, filter, queryVector };
      const inMemory = ix.recall(u, opts);
      const outside = ix.recall(u, opts, sameListsAs(ix, u, opts, (id) => filter(ix.byId.get(id)!)));
      expect(outside).toEqual(inMemory);
    }
  });

  it("applies the hard rules in code to lists from outside, whatever they contain", () => {
    const ix = new SearchIndex(products, map, vectors);
    const u = ix.understand("whipping cream", { claims: ["lactose_free"] });
    const filter = ix.hardFilter(u);
    // 800004 is whipping cream without the lactose-free claim: an outside list that carries it anyway.
    const c = ix.recall(u, { size: 10, filter, queryVector: unit(vecFor(1)) }, { lexical: ["800004", "800001"], vectors: [{ id: "800004", sim: 0.99 }, { id: "800003", sim: 0.9 }] });
    expect(c.map((x) => x.id)).not.toContain("800004");
    expect(c.map((x) => x.id)).toContain("800001");
  });
});

const ix = new SearchIndex(products, map, vectors);
const noVectors = new SearchIndex(products, map, null);
const u = ix.understand("whipping cream");
const opts = { size: 10, filter: ix.hardFilter(u), queryVector: unit(vecFor(2)) };
const remoteOf = (fn: () => Promise<ExternalLists>, calls = { n: 0 }): ListsSource => ({
  lists: () => {
    calls.n++;
    return fn();
  },
});
const echo = (index: SearchIndex) => remoteOf(async () => sameListsAs(index, u, opts, (id) => opts.filter(index.byId.get(id)!)));

describe("recall routing: a deadline, a breaker, and the other backend as the fallback", () => {
  it("OpenSearch first: answers when it is in time, with the same candidates as memory would", async () => {
    const r = new RecallRouter(ix, echo(ix), { primary: "opensearch", timeoutMs: 200 });
    const a = await r.recall(u, opts);
    expect(a.backend).toBe("opensearch");
    expect(a.fallback).toBeUndefined();
    expect(a.candidates).toEqual(ix.recall(u, opts));
    expect(r.stats().answered.opensearch).toBe(1);
  });

  it("OpenSearch late: memory answers within the deadline and the fallback is counted with its reason", async () => {
    const r = new RecallRouter(ix, remoteOf(() => new Promise(() => {})), { primary: "opensearch", timeoutMs: 20 });
    const t0 = Date.now();
    const a = await r.recall(u, opts);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(a.backend).toBe("memory");
    expect(a.fallback).toMatch(/opensearch: no answer within 20 ms/);
    expect(a.candidates).toEqual(ix.recall(u, opts));
    expect(r.stats().fallbacks).toBe(1);
  });

  it("three failures in a row open the breaker: OpenSearch is not asked again for its duration", async () => {
    const calls = { n: 0 };
    let now = 1_000;
    const r = new RecallRouter(ix, remoteOf(async () => Promise.reject(Object.assign(new Error("boom"), { meta: { statusCode: 503 } })), calls), { primary: "opensearch", timeoutMs: 50, breakerMs: 30_000, now: () => now });
    for (let i = 0; i < 3; i++) expect((await r.recall(u, opts)).backend).toBe("memory");
    expect(calls.n).toBe(3);
    const a = await r.recall(u, opts);
    expect(calls.n).toBe(3); // skipped
    expect(a.fallback).toMatch(/breaker open/);
    expect(r.stats().breakerOpenUntil).toBe(31_000);
    now = 40_000; // after the breaker's time: asked again
    await r.recall(u, opts);
    expect(calls.n).toBe(4);
  });

  it("memory first: OpenSearch answers while the vectors are not loaded yet, then memory does", async () => {
    const late = new SearchIndex(products, map, null);
    const calls = { n: 0 };
    const r = new RecallRouter(late, remoteOf(async () => sameListsAs(ix, u, opts, (id) => opts.filter(ix.byId.get(id)!)), calls), { primary: "memory", timeoutMs: 200 });
    expect(r.canSearchVectors()).toBe(true);
    const before = await r.recall(u, opts);
    expect(before.backend).toBe("opensearch");
    expect(before.fallback).toMatch(/memory: vectors not loaded/);
    late.attachVectors(vectors);
    const after = await r.recall(u, opts);
    expect(after.backend).toBe("memory");
    expect(calls.n).toBe(1);
    expect(after.candidates).toEqual(before.candidates);
  });

  it("both failing: memory recall without vectors, so a search still answers", async () => {
    const r = new RecallRouter(noVectors, remoteOf(async () => Promise.reject(new Error("down"))), { primary: "opensearch", timeoutMs: 50 });
    const a = await r.recall(u, opts);
    expect(a.backend).toBe("memory-no-vectors");
    expect(a.candidates.length).toBeGreaterThan(0);
    expect(a.candidates.every((c) => !c.sources.includes("vectors"))).toBe(true);
  });

  it("without OpenSearch configured: memory only, as before", async () => {
    const r = new RecallRouter(ix, undefined, { primary: "opensearch" });
    expect(r.order).toEqual(["memory"]);
    expect((await r.recall(u, opts)).backend).toBe("memory");
  });
});

describe("the OpenSearch side: one msearch, cheap exact filters pushed down", () => {
  it("asks the keyword lists and the nearest vectors with the same filters", () => {
    const uu = ix.understand("lactose free whipping cream without nuts");
    const plan = ix.recallPlan(uu, { size: 50, queryVector: unit(vecFor(1)) });
    const s = buildRecallSearches(uu, plan, { queryVector: unit(vecFor(1)), category: "dairy" });
    expect(s.map((x) => x.source)).toEqual(["lexical", "words", "vectors"]);
    const knn = (s[2].body.query as { knn: { vec: { k: number; filter: { bool: { filter: unknown[]; must_not: unknown[] } } } } }).knn.vec;
    expect(knn.k).toBe(60 + 40); // 60 nearest, plus room for the code's own allergen rule
    expect(JSON.stringify(knn.filter.bool.filter)).toContain('"claims":"lactose_free"');
    expect(JSON.stringify(knn.filter.bool.must_not)).toContain('"allergens.contains":"nuts"');
    const f = recallFilter({ claims: [], forbiddenAllergens: [], ids: ["1", "2"] });
    expect(f.filter).toEqual([{ terms: { id: ["1", "2"] } }]);
  });

  it("reads the answers back as ranked lists, with the cosine from Lucene's score", () => {
    const searches = [
      { source: "lexical" as const, body: {} },
      { source: "vectors" as const, body: {} },
    ];
    const lists = toExternalLists(searches, { responses: [{ hits: { hits: [{ _id: "a", _score: 312 }, { _id: "b", _score: 200 }] } }, { hits: { hits: [{ _id: "c", _score: 0.9 }] } }] });
    expect(lists).toEqual({ lexical: ["a", "b"], vectors: [{ id: "c", sim: cosineOf(0.9) }] });
    expect(cosineOf(0.9)).toBe(0.8);
    expect(() => toExternalLists(searches, { responses: [{ error: { type: "index_not_found_exception" } }, {}] })).toThrow(/lexical search failed/);
    expect(() => toExternalLists(searches, { responses: [{}] })).toThrow(/answered 1 of 2/);
  });

  it("indexes the product's vector, kind and family next to its names", () => {
    const d = toRecallDoc(products[0], vecFor(0), { kind: "80401.whipping_cream", family: "cream" });
    expect(d.vec).toHaveLength(DIM);
    expect(d.kind).toBe("80401.whipping_cream");
    expect(d.names.en).toBe(products[0].names.en);
  });
});

describe("the search event: counts, codes and milliseconds, never words", () => {
  it("has the shape the panels read", () => {
    const f = searchFacts(
      { need: { itemText: "secret words of the buyer" } },
      {
        path: "judge",
        stats: { candidates: 50, ms: 700, embedMs: 120, recallMs: 30, judgeMs: 500, costUsd: 0.0006, recallBackend: "opensearch", recallFallback: undefined },
        candidates: [
          { id: "1", sources: [], verdict: { label: "exact", confidence: 1, score: 1 } },
          { id: "2", sources: [], verdict: { label: "standin", confidence: 1, score: 1 } },
          { id: "3", sources: [] },
        ],
        notSold: false,
        onlyStandins: false,
        unsure: false,
      } as never,
    );
    expect(f).toEqual({ request: "need", backend: "opensearch", fallback: false, path: "judge", candidates: 50, exact: 1, variant: 0, standin: 1, other: 0, embed_ms: 120, recall_ms: 30, judge_ms: 500, total_ms: 700, cost_usd: 0.0006, not_sold: false, only_standins: false, unsure: false, judge_missed: false });
    expect(JSON.stringify(f)).not.toMatch(/secret/);
  });
});
