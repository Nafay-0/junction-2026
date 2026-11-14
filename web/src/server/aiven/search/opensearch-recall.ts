import { Client } from "@opensearch-project/opensearch";
import { categoryCodesFor, type IndexedProduct } from "@/core/catalog/partner";
import type { ExternalLists, KeywordAsk, RecallPlan, Understood } from "@/server/search/recall";
import { indexMappings, indexSettings, toDoc, type ProductDoc } from "./mapping";
import { termQuery } from "./opensearch-search";

/**
 * Smart search's recall on Aiven OpenSearch: the keyword lists and the nearest-vector list for one request, in one
 * `_msearch` round trip, from an index that holds every product's names (three languages, stemmed, folded and in
 * n-grams, as the catalogue's keyword index) and its semantic vector (768 dimensions, gemini-embedding-2, HNSW).
 *
 * Why `_msearch` and not OpenSearch's hybrid query (neural-search, present on the 3.6 service): the hybrid query
 * normalises and combines its sub-queries' scores into one list, and smart search fuses by reciprocal rank with a
 * weight and a quota per source plus the knowledge map's kinds and use lift (recall.ts fuseLists). Getting each
 * source's own ranked list back and fusing it with the same code keeps the two backends' answers comparable, and
 * the fusion stays plain code that the evaluation measures.
 *
 * Cheap exact filters go into every query (an id list, the family's category codes, every required claim, no
 * declared or "may contain" forbidden allergen). The hard rules still run in code on whatever comes back
 * (recall.ts hardFilter): "unknown is not safe" and the fresh-produce-by-nature exception are not repeated here.
 */

export const RECALL_ALIAS = "dock-recall";
export const RECALL_INDEX_PREFIX = `${RECALL_ALIAS}-v`;
export const RECALL_DIM = 768;

export const recallIndexSettings = { ...indexSettings, knn: true } as const;

/** The catalogue index's fields, plus the vector and the knowledge map's kind and family. */
export const recallIndexMappings = {
  ...indexMappings,
  properties: {
    ...indexMappings.properties,
    // Lucene's HNSW: on disk and memory-mapped, not a native graph in the free plan's small heap; cosine, which is
    // what the vectors were built for (unit vectors, vectors.ts); efficient filtering with the filters above.
    vec: { type: "knn_vector", dimension: RECALL_DIM, method: { name: "hnsw", engine: "lucene", space_type: "cosinesimil", parameters: { m: 16, ef_construction: 128 } } },
    kind: { type: "keyword" },
    family: { type: "keyword" },
  },
} as const;

export type RecallDoc = ProductDoc & { vec?: number[]; kind?: string; family?: string };

export function toRecallDoc(p: IndexedProduct, vector: Float32Array | number[] | undefined, profile?: { kind?: string; family?: string }): RecallDoc {
  return {
    ...toDoc(p),
    ...(vector ? { vec: Array.from(vector, (x) => Math.round(x * 1e5) / 1e5) } : {}),
    ...(profile?.kind ? { kind: profile.kind } : {}),
    ...(profile?.family ? { family: profile.family } : {}),
  };
}

/** The allergens whose declared absence meets a claim (the same table as core/claim-evidence.ts, checked by a test). */
export const CLAIM_ALLERGENS: Record<string, string[]> = {
  lactose_free: ["milk", "lactose"],
  low_lactose: ["milk", "lactose"],
  egg_free: ["eggs"],
  soy_free: ["soy"],
  wheat_free: ["wheat"],
  gluten_free: ["gluten", "oats"],
};

export type RecallFilters = { claims: string[]; forbiddenAllergens: string[]; category?: string; ids?: string[] };

/** The cheap exact filters, in OpenSearch's words. */
export function recallFilter(f: RecallFilters): { filter: unknown[]; must_not: unknown[] } {
  const filter: unknown[] = [];
  const mustNot: unknown[] = [];
  if (f.ids) filter.push({ terms: { id: f.ids } });
  if (f.category) {
    const codes = categoryCodesFor(f.category);
    filter.push(codes.length ? { terms: { categoryCode: codes } } : { match_none: {} });
  }
  for (const c of f.claims) {
    // A claim that is the absence of declared allergens can be met without the label (core/claim-evidence.ts: the
    // declaration, fresh produce by nature, an ingredient list): the query keeps every product that might meet it and
    // the code's hard filter decides. Other claims (vegan, organic) are the label only.
    const absent = CLAIM_ALLERGENS[c];
    filter.push(absent ? { bool: { should: [{ term: { claims: c } }, { bool: { must_not: [{ terms: { "allergens.contains": absent } }, { terms: { "allergens.may_contain": absent } }] } }], minimum_should_match: 1 } } : { term: { claims: c } });
  }
  for (const a of f.forbiddenAllergens) {
    mustNot.push({ term: { "allergens.contains": a } }, { term: { "allergens.may_contain": a } });
    // Unknown is not safe: declared data, or "free from", or fresh produce (174xx) that may be safe by its nature
    // (core/catalog/nature.ts decides that in code, after).
    filter.push({ bool: { should: [{ term: { "allergens.free_from": a } }, { term: { "allergens.declared": true } }, { prefix: { categoryCode: "174" } }], minimum_should_match: 1 } });
  }
  return { filter, must_not: mustNot };
}

/** HNSW candidates looked at per search: wide enough that the approximate top list matches the exact one closely. */
const EF_SEARCH = 400;

/** A matched word counts for this much more than any text score, so "and" ranks products carrying more of the words first (as keywordRank does). */
const PER_WORD = 100;

function keywordBody(ask: KeywordAsk, f: { filter: unknown[]; must_not: unknown[] }, extra: number): Record<string, unknown> {
  const should = ask.terms.map((t) =>
    ask.mode === "and" ? { bool: { should: [{ constant_score: { filter: termQuery(t), boost: PER_WORD } }, termQuery(t)] } } : termQuery(t),
  );
  return {
    size: ask.limit + extra,
    _source: false,
    track_total_hits: false,
    query: { bool: { should, minimum_should_match: 1, filter: f.filter, must_not: f.must_not } },
    sort: ["_score", { nameLength: "asc" }, { id: "asc" }],
    track_scores: true,
  };
}

export type RecallSearch = { source: "lexical" | "typo" | "words" | "vectors"; body: Record<string, unknown> };

/**
 * The searches for one request. `extra`: results asked beyond each list's size, because the code's hard filter
 * may still remove some (allergens with no data); the lists are cut back to size after it.
 */
export function buildRecallSearches(u: Pick<Understood, "claims" | "forbiddenAllergens">, plan: RecallPlan, opts: { queryVector?: Float32Array; category?: string; ids?: string[] }): RecallSearch[] {
  const f = recallFilter({ claims: u.claims, forbiddenAllergens: u.forbiddenAllergens, ...(opts.category ? { category: opts.category } : {}), ...(opts.ids ? { ids: opts.ids } : {}) });
  const extra = u.forbiddenAllergens.length ? 40 : 10;
  const out: RecallSearch[] = [];
  for (const source of ["lexical", "typo", "words"] as const) {
    const ask = plan[source];
    if (ask && ask.terms.length) out.push({ source, body: keywordBody(ask, f, extra) });
  }
  if (plan.vectors && opts.queryVector) {
    const k = plan.vectors.k + extra;
    const filter = f.filter.length || f.must_not.length ? { bool: { filter: f.filter, must_not: f.must_not } } : undefined;
    out.push({
      source: "vectors",
      body: { size: k, _source: false, track_total_hits: false, query: { knn: { vec: { vector: Array.from(opts.queryVector), k, method_parameters: { ef_search: Math.max(EF_SEARCH, 2 * k) }, ...(filter ? { filter } : {}) } } } },
    });
  }
  return out;
}

type MsearchHit = { _id?: string; _score?: number | null };
type MsearchResponse = { responses?: Array<{ hits?: { hits?: MsearchHit[] }; error?: { type?: string; reason?: string } | string; status?: number }> };

/** Lucene's cosine score is (1 + cos) / 2; back to the cosine, rounded as the in-process vectors round it. */
export const cosineOf = (score: number) => Math.round((2 * score - 1) * 1000) / 1000;

/** The msearch response, as the ranked lists recall fuses. An error in any one search fails the whole answer (the fallback answers). */
export function toExternalLists(searches: RecallSearch[], raw: unknown): ExternalLists {
  const res = (raw as MsearchResponse)?.responses ?? [];
  if (res.length !== searches.length) throw new Error(`msearch answered ${res.length} of ${searches.length} searches`);
  const out: ExternalLists = {};
  searches.forEach((s, i) => {
    const r = res[i];
    if (r.error) throw new Error(`OpenSearch ${s.source} search failed: ${typeof r.error === "string" ? r.error : (r.error.type ?? "error")}`);
    const hits = r.hits?.hits ?? [];
    if (s.source === "vectors") out.vectors = hits.flatMap((h) => (h._id ? [{ id: h._id, sim: cosineOf(h._score ?? 0) }] : []));
    else out[s.source] = hits.flatMap((h) => (h._id ? [h._id] : []));
  });
  return out;
}

/** Minimal client surface, so tests can pass a fake. */
export type RecallClient = {
  msearch(params: { index?: string; body: unknown[] }, options?: { requestTimeout?: number; maxRetries?: number }): Promise<{ body: unknown }>;
  count(params: { index: string }, options?: { requestTimeout?: number; maxRetries?: number }): Promise<{ body: unknown }>;
};

export class OpenSearchRecall {
  readonly index: string;
  private readonly client: RecallClient;
  private readonly timeoutMs: number;

  constructor(opts: { url?: string; client?: RecallClient | Client; index?: string; timeoutMs?: number }) {
    if (!opts.client && !opts.url) throw new Error("OpenSearchRecall needs a url or a client.");
    this.timeoutMs = opts.timeoutMs ?? 1500;
    this.client = (opts.client ?? new Client({ node: opts.url!, requestTimeout: this.timeoutMs, maxRetries: 0 })) as RecallClient;
    this.index = opts.index ?? RECALL_ALIAS;
  }

  /** The keyword and vector lists for a request, in one round trip. */
  async lists(u: Pick<Understood, "claims" | "forbiddenAllergens">, plan: RecallPlan, opts: { queryVector?: Float32Array; category?: string; ids?: string[] }): Promise<ExternalLists> {
    const searches = buildRecallSearches(u, plan, opts);
    if (!searches.length) return {};
    const body = searches.flatMap((s) => [{ index: this.index }, s.body]);
    const res = await this.client.msearch({ body }, { requestTimeout: this.timeoutMs, maxRetries: 0 });
    return toExternalLists(searches, res.body);
  }

  /** Reachable, and how many products the index serves. Never throws. */
  async health(): Promise<{ ok: boolean; ms: number; detail: string }> {
    const t0 = performance.now();
    try {
      const res = await this.client.count({ index: this.index }, { requestTimeout: this.timeoutMs, maxRetries: 0 });
      const count = (res.body as { count?: number })?.count ?? 0;
      return { ok: count > 0, ms: Math.round(performance.now() - t0), detail: count > 0 ? `${count} products with vectors in ${this.index}` : `${this.index} is empty: run pnpm search:publish:opensearch` };
    } catch (err) {
      const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
      return { ok: false, ms: Math.round(performance.now() - t0), detail: status === 404 ? `${this.index} does not exist: run pnpm search:publish:opensearch` : `${(err as { name?: string })?.name ?? "Error"}${status ? ` (HTTP ${status})` : ""}` };
    }
  }
}
