import { Client } from "@opensearch-project/opensearch";
import { categoryCodesFor, type IndexedProduct } from "@/core/catalog/partner";
import { allergenEvidence, fold, parseQueryText, tokenize, type ParsedQuery, type SearchHit, type SearchQuery } from "@/core/catalog/search";
import { FACETS, SEARCH_ALIAS } from "./mapping";

/**
 * Product search on OpenSearch, with the same query semantics as the in-process LexicalSearch
 * (core/catalog/search.ts): the same query understanding (parseQueryText: claims, "dairy free", pack sizes and
 * order amounts in three languages), the same hard filters, the same allergen evidence rules (unknown is never
 * safe), and similar ranking hints. Text relevance is OpenSearch's: BM25 over stemmed, folded and n-gram fields.
 *
 * Returns the product objects of the local index (`byId`), so callers get exactly what the in-process search
 * would return for the same id; OpenSearch only decides which ids and in what order.
 */

/** Minimal surface of the client used here, so tests can pass a fake. */
export type SearchClient = {
  search(params: { index: string; body: Record<string, unknown> }, options?: { requestTimeout?: number; maxRetries?: number }): Promise<{ body: unknown }>;
  count(params: { index: string }, options?: { requestTimeout?: number; maxRetries?: number }): Promise<{ body: unknown }>;
};

export type OpenSearchProductSearchOptions = {
  url?: string;
  client?: SearchClient | Client;
  alias?: string;
  timeoutMs?: number;
  byId: (id: string) => IndexedProduct | undefined;
};

const FACET_PENALTY = 0.3;
const CATEGORY_COHERENCE_BOOST = 1.4;

type Bool = { must?: unknown[]; filter?: unknown[]; must_not?: unknown[]; should?: unknown[]; minimum_should_match?: number | string };

/** Facets the query itself names, so they are not penalised ("coffee milk" may return coffee milk). */
export function queryFacets(text: string): Set<string> {
  const folded = ` ${fold(text)} `;
  const tokens = tokenize(text);
  return new Set(FACETS.filter((f) => f.words.some((w) => (w.length <= 3 ? tokens.includes(w) : folded.includes(w)))).map((f) => f.id));
}

/** One term as a disjunction over the fields that can carry it: exact folded, stemmed, compound part, typo. */
export function termQuery(t: string): unknown {
  const clauses: unknown[] = [
    { multi_match: { query: t, fields: ["names.fi.folded", "names.sv.folded", "names.en.folded", "brand"], boost: 3 } },
    { multi_match: { query: t, fields: ["names.fi.stem", "names.sv.stem", "names.en.stem"], boost: 2 } },
  ];
  if (t.length >= 4) clauses.push({ match: { "all.gram": { query: t, minimum_should_match: "75%", boost: 0.8 } } });
  if (t.length >= 5) clauses.push({ multi_match: { query: t, fields: ["names.fi.folded", "names.sv.folded", "names.en.folded"], fuzziness: "AUTO:5,8", prefix_length: 1, boost: 0.6 } });
  return { dis_max: { queries: clauses, tie_breaker: 0.1 } };
}

export type BuiltQuery = { body: Record<string, unknown>; parsed: ParsedQuery; claims: string[]; forbidden: string[]; limit: number; fetch: number };

/**
 * The OpenSearch request for a SearchQuery. `maxMissing` lets up to that many text terms go unmatched (the
 * in-process search does the same when nothing matches every term).
 */
export function buildSearchBody(query: SearchQuery, maxMissing = 0): BuiltQuery {
  const parsed = parseQueryText(query.text ?? "");
  const claims = [...new Set([...(query.requiredClaims ?? []), ...parsed.claims])];
  const forbidden = [...new Set([...(query.forbiddenAllergens ?? []), ...parsed.excludeAllergens])];
  const proof = query.allergenProof ?? "declared";
  const limit = Math.min(Math.max(query.limit ?? 10, 1), 100);

  const filter: unknown[] = [];
  const mustNot: unknown[] = [];
  if (query.ids) filter.push({ terms: { id: query.ids } });
  if (query.category) {
    const codes = categoryCodesFor(query.category);
    filter.push(codes.length ? { terms: { categoryCode: codes } } : { match_none: {} });
  }
  for (const c of claims) filter.push({ term: { claims: c } });
  const minC = query.minPackContent;
  if (minC) {
    filter.push({ term: { "pack.certainMeasures": minC.unit } });
    filter.push({ range: { [`pack.${minC.unit}`]: { gte: minC.amount } } });
  }
  for (const a of forbidden) {
    mustNot.push({ term: { "allergens.contains": a } }, { term: { "allergens.may_contain": a } });
    // Unknown is not safe: either an explicit "free from", or allergen data that does not list it.
    if (proof === "free_from") filter.push({ term: { "allergens.free_from": a } });
    else filter.push({ bool: { should: [{ term: { "allergens.free_from": a } }, { term: { "allergens.declared": true } }], minimum_should_match: 1 } });
  }

  const terms = parsed.terms;
  const text: Bool = {};
  if (terms.length) {
    text.should = [
      ...terms.map(termQuery),
      // Words next to each other in one name rank above words scattered across languages.
      { multi_match: { query: terms.join(" "), type: "phrase", slop: 2, fields: ["names.fi.folded", "names.sv.folded", "names.en.folded"], boost: 2 } },
    ];
    text.minimum_should_match = Math.max(terms.length - maxMissing, 1);
  }
  const main = { bool: { ...(terms.length ? { must: [{ bool: text }] } : { must: [{ match_all: {} }] }), filter, must_not: mustNot } };

  // Products of a kind the query did not name are ranked down (coffee milk, chocolate milk for "milk").
  const asked = queryFacets(query.text ?? "");
  const notAsked = FACETS.map((f) => f.id).filter((f) => !asked.has(f));
  const ranked = terms.length && notAsked.length ? { boosting: { positive: main, negative: { terms: { facets: notAsked } }, negative_boost: FACET_PENALTY } } : main;

  // Pack size and measure hints, multiplicative like the in-process search.
  const functions: unknown[] = [];
  const want = parsed.packSize;
  if (want) {
    functions.push({
      filter: { bool: { should: [{ term: { [`pack.base_${want.unit}`]: want.amount } }, { term: { [`pack.${want.unit}`]: want.amount } }], minimum_should_match: 1 } },
      weight: 1.5,
    });
  }
  const measure = parsed.orderAmount?.unit ?? want?.unit;
  if (measure) functions.push({ filter: { bool: { must_not: [{ term: { "pack.certainMeasures": measure } }] } }, weight: 0.8 });
  const order = parsed.orderAmount;
  if (order) {
    // Bigger packs for a big order: 1 + 0.15 * log10(min(per pack, order)), in steps.
    for (const per of [5, 10, 20, 100]) {
      functions.push({ filter: { bool: { filter: [{ term: { "pack.certainMeasures": order.unit } }, { range: { [`pack.${order.unit}`]: { gte: per } } }] } }, weight: 1 + 0.04 * Math.log10(Math.min(per, order.amount)) });
    }
  }
  const scored = functions.length ? { function_score: { query: ranked, functions, score_mode: "multiply", boost_mode: "multiply" } } : ranked;

  // Fetch more than asked for, then apply category coherence on the client (see rerank()).
  const fetch = terms.length ? Math.min(Math.max(limit * 3, 30), 150) : limit;
  return {
    body: {
      size: fetch,
      track_total_hits: false,
      _source: ["id", "facets", "categoryCode"],
      query: scored,
      sort: ["_score", { "pack.certain": "desc" }, { nameLength: "asc" }, { id: "asc" }],
      track_scores: true,
    },
    parsed,
    claims,
    forbidden,
    limit,
    fetch,
  };
}

type RawHit = { _id?: string; _score?: number | null; _source?: { id?: string; facets?: string[]; categoryCode?: string } };

/** Turn the response into SearchHits: local product objects, category coherence, reasons. */
export function toHits(raw: unknown, built: BuiltQuery, query: SearchQuery, byId: (id: string) => IndexedProduct | undefined): SearchHit[] {
  const hits = ((raw as { hits?: { hits?: RawHit[] } })?.hits?.hits ?? []).flatMap((h) => {
    const id = h._source?.id ?? h._id;
    const product = id ? byId(id) : undefined;
    return product ? [{ product, score: h._score ?? 0, facets: h._source?.facets ?? [], why: [] as string[] }] : [];
  });
  const { parsed, claims, forbidden } = built;
  const asked = queryFacets(query.text ?? "");
  const terms = parsed.terms;

  // Category coherence: the category most of the best matches share is probably what was meant.
  if (terms.length && hits.length > 3) {
    const mass = new Map<string, number>();
    for (const x of hits.slice(0, 20)) mass.set(x.product.categoryCode, (mass.get(x.product.categoryCode) ?? 0) + x.score);
    const total = [...mass.values()].reduce((a, b) => a + b, 0);
    const [bestCat, bestMass] = [...mass.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total > 0 && bestMass / total >= 0.35) for (const x of hits) if (x.product.categoryCode === bestCat) x.score *= CATEGORY_COHERENCE_BOOST;
  }
  for (const x of hits) {
    const extra = x.facets.filter((f) => !asked.has(f));
    if (extra.length && terms.length) x.why.push(`ranked down: ${extra.join(", ")} not asked for`);
    const want = parsed.packSize;
    const pk = x.product.pack;
    if (want) {
      const base = pk.perBaseUnit[want.unit];
      const sales = pk.perSalesUnit[want.unit];
      if ((base !== undefined && Math.abs(base - want.amount) < 1e-6) || (sales !== undefined && Math.abs(sales - want.amount) < 1e-6)) x.why.push(`pack size ${want.amount} ${want.unit} as asked`);
    }
    const measure = parsed.orderAmount?.unit ?? want?.unit;
    if (measure && !pk.certainMeasures.includes(measure)) x.why.push(`content per ${pk.salesUnit} in ${measure} not certain`);
  }
  // Stable order after the rerank: score, then the same tie-breaks as the in-process search.
  const nameLength = (p: IndexedProduct) => (p.names.en ?? p.names.fi ?? "").length;
  hits.sort((a, b) => b.score - a.score || Number(b.product.pack.certain) - Number(a.product.pack.certain) || nameLength(a.product) - nameLength(b.product) || a.product.id.localeCompare(b.product.id));
  return hits.slice(0, built.limit).map((x) => {
    const hit: SearchHit = { product: x.product, score: Math.round(x.score * 1000) / 1000, why: ["ranked by OpenSearch", ...x.why] };
    if (claims.length) hit.why.unshift(`carries ${claims.join(", ")}`);
    if (forbidden.length) hit.allergens = Object.fromEntries(forbidden.map((a) => [a, allergenEvidence(x.product, a)]));
    return hit;
  });
}

export class OpenSearchProductSearch {
  readonly alias: string;
  private readonly client: SearchClient;
  private readonly timeoutMs: number;
  private readonly byId: (id: string) => IndexedProduct | undefined;

  constructor(opts: OpenSearchProductSearchOptions) {
    if (!opts.client && !opts.url) throw new Error("OpenSearchProductSearch needs a url or a client.");
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.client = (opts.client ?? new Client({ node: opts.url!, requestTimeout: this.timeoutMs, maxRetries: 0 })) as SearchClient;
    this.alias = opts.alias ?? SEARCH_ALIAS;
    this.byId = opts.byId;
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const opts = { requestTimeout: this.timeoutMs, maxRetries: 0 };
    let built = buildSearchBody(query);
    let res = await this.client.search({ index: this.alias, body: built.body }, opts);
    let hits = toHits(res.body, built, query, this.byId);
    const terms = built.parsed.terms.length;
    // Nothing matches every term: accept hits that miss up to half of them, as the in-process search does.
    if (hits.length === 0 && terms > 1) {
      built = buildSearchBody(query, Math.floor(terms / 2));
      res = await this.client.search({ index: this.alias, body: built.body }, opts);
      hits = toHits(res.body, built, query, this.byId);
    }
    return hits;
  }

  /** Reachable, and how many products the alias serves. Never throws. */
  async health(): Promise<{ ok: boolean; ms: number; detail: string }> {
    const t0 = performance.now();
    try {
      const res = await this.client.count({ index: this.alias }, { requestTimeout: this.timeoutMs, maxRetries: 0 });
      const count = (res.body as { count?: number })?.count ?? 0;
      return { ok: count > 0, ms: Math.round(performance.now() - t0), detail: count > 0 ? `${count} products in ${this.alias}` : `${this.alias} is empty: run pnpm aiven:search:index` };
    } catch (err) {
      const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
      const name = (err as { name?: string })?.name ?? "Error";
      return { ok: false, ms: Math.round(performance.now() - t0), detail: status === 404 ? `${this.alias} does not exist: run pnpm aiven:search:index` : `${name}${status ? ` (HTTP ${status})` : ""}` };
    }
  }
}
