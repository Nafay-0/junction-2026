import { describe, expect, it } from "vitest";
import { KnowledgeMap } from "@/server/knowledge/map";
import { testKnowledge, testProducts } from "@/server/knowledge/test-catalogue";
import { SearchIndex, type ExternalLists } from "./recall";
import { probeRecall } from "./recall-probe";
import type { ListsSource } from "./recall-router";
import { ProductVectors, quantise } from "./vectors";

// Synthetic catalogue and vectors; the "OpenSearch" side is a fake that answers with memory's own lists after a delay.
const products = testProducts();
const map = new KnowledgeMap(products, testKnowledge());
const vecFor = (i: number) => Float32Array.from([Math.cos(i), Math.sin(i), Math.cos(2 * i) * 0.5, 0.3]);
const { data, scale } = quantise(products.map((_, i) => vecFor(i)), 4);
const meta = { format: "dock-search-vectors", version: 1, model: "test", dim: 4, builtAt: "2026-11-14T00:00:00Z", recipe: "test", count: products.length, tokens: 0, costUsd: 0 } as const;
const index = new SearchIndex(products, map, new ProductVectors(meta, products.map((p) => p.id), data, scale));
const unit = (v: Float32Array) => v.map((x) => x / Math.hypot(...v));

/** Memory's own lists, as OpenSearch would hand them over, after `delayMs`; or a failure. */
const fake = (delayMs: number, calls: { n: number }, fail = false): ListsSource => ({
  lists: async (u, plan, opts) => {
    calls.n++;
    await new Promise((r) => setTimeout(r, delayMs));
    if (fail) throw new Error("down");
    const all = () => true;
    const out: ExternalLists = {
      ...(plan.lexical ? { lexical: index.keywordRank(plan.lexical.terms, "and", all, 200) } : {}),
      ...(plan.typo ? { typo: index.keywordRank(plan.typo.terms, "and", all, 200) } : {}),
      ...(plan.words ? { words: index.keywordRank(plan.words.terms, "or", all, 200) } : {}),
      ...(plan.vectors && opts.queryVector ? { vectors: index.vectors!.nearest(opts.queryVector, 200) } : {}),
    };
    return out;
  },
});
const embedCalls: string[] = [];
const embed = async (text: string) => {
  embedCalls.push(text);
  return { vector: unit(vecFor(text.length)), ms: 5 };
};
const QUERIES = ["whipping cream", "lactose free milk", "pizza cheese", "carrot"];

describe("timing both recall backends", () => {
  it("embeds each query once, warms up, times both, counts the late ones and compares the lists", async () => {
    embedCalls.length = 0;
    const calls = { n: 0 };
    const r = await probeRecall({ index, remote: fake(30, calls), embed, recallSize: 10, deadlineMs: 20, judgeMs: { value: 300, from: "test" } }, QUERIES);
    expect(calls.n).toBe(3 + QUERIES.length); // three warm-up calls, then one per query
    expect(embedCalls).toEqual([QUERIES[0], ...QUERIES]); // the warm-up query, then each query once, for both backends
    expect(r.queries).toBe(4);
    expect(r.opensearch.timedOut).toBe(4);
    expect(r.opensearch.p50).toBeGreaterThanOrEqual(25);
    expect(r.memory.p50).toBeLessThan(r.opensearch.p50);
    expect(r.overlap).toBe(1); // the same lists: the same candidates
    expect(r.endToEnd.opensearch.p50).toBeGreaterThan(r.endToEnd.memory.p50);
    expect(r.endToEnd.memory.p50).toBeGreaterThanOrEqual(305);
    expect(r.reading).toMatch(/^OpenSearch recall is \d+ ms slower at p50 here/);
    expect(r.reading).toMatch(/4 of 4 over the 20 ms deadline/);
  });

  it("says so when OpenSearch does not answer", async () => {
    const r = await probeRecall({ index, remote: fake(1, { n: 0 }, true), embed, recallSize: 10, deadlineMs: 400, judgeMs: { value: 300, from: "test" } }, QUERIES);
    expect(r.opensearch.failed).toBe(4);
    expect(r.reading).toMatch(/did not answer any of the 4 queries/);
    expect(r.memory.candidates.min).toBeGreaterThan(0);
  });
});
