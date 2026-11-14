import type { CatalogPort, Product } from "@/core/catalog";
import type { FindRequest, FindResult, FoundProduct, ProductFinder } from "@/core/catalog/finder";
import type { IndexedProduct } from "@/core/catalog/partner";
import { admitSearchCall, recordLlmSpend } from "@/server/limits";
import { getKnowledgeMap } from "@/server/knowledge/service";
import { SmartSearch, type SearchCall, type SmartConfig } from "./finder";
import { EMBED_MODEL, embedTexts, geminiKey, queryPrompt } from "./gemini";
import { DecisionsJudge, type RelevanceJudge } from "./judge";
import { SearchIndex } from "./recall";
import { loadVectorsFile, resolveVectorsFile, type ProductVectors } from "./vectors";

/**
 * The one product search every caller uses: `findProducts(catalog, request)`. The intake's candidate search (through
 * the core's ProductFinder port), the thread's product results, the menu's ingredient matching and the catalogue's
 * search box all come here.
 *
 * With the partner's catalogue it is smart search (finder.ts): recall over the whole assortment, the hard rules in
 * code, the relevance judge. Anything else (the seed catalogue, the crash world's own catalogue, every test) gets
 * the catalogue's own lexical search, unchanged, with path "lexical". Settings (names in web/.env.example):
 *
 *   DOCK_SMART_SEARCH                "off": lexical search only, as before (default on with the partner catalogue)
 *   DOCK_SEARCH_JUDGE                "off": recall and fused ranking only, no relevance judge
 *   DOCK_SEARCH_JUDGE_TIMEOUT_MS     the judge's deadline (default 800); late, the fused ranking answers
 *   DOCK_SEARCH_RECALL               candidates the judge sees (default 50: the evaluation's best, eval/search/run.ts)
 *   DOCK_SEARCH_EMBED_TIMEOUT_MS     the query embedding's deadline (default 700); late, recall goes on without vectors
 *   DOCK_SEARCH_VECTORS_PATH         the vectors file (default .data/valio/search-vectors.json.gz; pnpm search:vectors)
 *   DOCK_SEARCH_DAILY_CALLS          smart search's model calls per UTC day (server/limits.ts)
 *
 * Under vitest smart search is off whatever the environment says (lexical search, as the tests were written): a test
 * that wants it builds one with a scripted judge and sets it (setSmartSearchForTests). GEMINI_API_KEY is read from
 * the environment only.
 */

const envValue = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};
const num = (name: string, fallback: number) => {
  const n = Number(envValue(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export type SmartStatus = { on: boolean; reason?: string; vectors?: { count: number; dim: number; model: string; from: string }; judge: boolean };

type Holder = { search: SmartSearch | null; status: SmartStatus; products: IndexedProduct[] };
const g = globalThis as typeof globalThis & { __dockSmart?: Map<IndexedProduct[], Promise<Holder>>; __dockSmartTest?: SmartSearch | null };

/** The model calls go through the daily caps and into the telemetry record. */
function observe(call: SearchCall): void {
  if (call.costUsd > 0) recordLlmSpend(call.costUsd);
  void import("@/server/thread/telemetry")
    .then((t) => t.recordExternalModelCall({ functionId: `search.${call.kind}`, model: call.model.includes(":") ? call.model : `google:${call.model}`, ms: call.ms, ok: call.ok, inputTokens: call.tokens, costUsd: call.costUsd }))
    .catch(() => {});
}

/** One query embedding at a time per text: cached (500 texts), each with its deadline. */
function embedder(dim: number) {
  const cache = new Map<string, Float32Array>();
  return async (text: string, timeoutMs: number) => {
    const k = text.trim().toLowerCase();
    const hit = cache.get(k);
    if (hit) return { vector: hit, tokens: 0, cached: true };
    const r = await embedTexts([queryPrompt(text)], dim, timeoutMs);
    cache.set(k, r.vectors[0]);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return { vector: r.vectors[0], tokens: r.tokens, cached: false };
  };
}

async function build(products: IndexedProduct[]): Promise<Holder> {
  const testing = !!process.env.VITEST;
  if (envValue("DOCK_SMART_SEARCH") === "off") return { search: null, status: { on: false, reason: "DOCK_SMART_SEARCH=off", judge: false }, products };
  let vectors: ProductVectors | null = null;
  let vfrom = "none";
  if (!testing) {
    const src = await resolveVectorsFile();
    if (src.from !== "none") {
      try {
        vectors = loadVectorsFile(src.file);
        vfrom = src.from;
      } catch (err) {
        console.error(`search vectors not loaded: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
      }
    }
  }
  const map = await getKnowledgeMap().catch(() => null);
  const index = new SearchIndex(products, map, vectors);
  const keyed = !testing && !!geminiKey();
  const judgeOn = keyed && envValue("DOCK_SEARCH_JUDGE") !== "off";
  const judge: RelevanceJudge | undefined = judgeOn ? new DecisionsJudge() : undefined;
  const config: Partial<SmartConfig> = { recallSize: num("DOCK_SEARCH_RECALL", 50), judgeTimeoutMs: num("DOCK_SEARCH_JUDGE_TIMEOUT_MS", 800), embedTimeoutMs: num("DOCK_SEARCH_EMBED_TIMEOUT_MS", 700), judge: judgeOn };
  const search = new SmartSearch({ index, ...(judge ? { judge } : {}), ...(keyed && vectors ? { embed: embedder(vectors.meta.dim) } : {}), config, admit: () => admitSearchCall(), observe });
  return {
    search,
    status: { on: true, judge: judgeOn, ...(vectors ? { vectors: { count: vectors.size, dim: vectors.meta.dim, model: vectors.meta.model ?? EMBED_MODEL, from: vfrom } } : {}), ...(!map ? { reason: "no knowledge map: kinds and uses are not used" } : !vectors ? { reason: "no search vectors: semantic recall is off (pnpm search:vectors)" } : !keyed ? { reason: "GEMINI_API_KEY not set: no judge, no query embedding" } : {}) },
    products,
  };
}

/** The partner index a catalogue searches, when it is (or wraps) the partner's catalogue. */
function indexOf(catalog: unknown): IndexedProduct[] | undefined {
  let c = catalog as { index?: { products?: IndexedProduct[] }; inner?: unknown } | undefined;
  for (let i = 0; c && i < 4; i++) {
    if (c.index?.products && Array.isArray(c.index.products)) return c.index.products;
    c = c.inner as typeof c;
  }
  return undefined;
}

/** Smart search over this catalogue, or null when it is not the partner's (or smart search is off). */
export async function smartSearchFor(catalog: unknown): Promise<SmartSearch | null> {
  if (g.__dockSmartTest !== undefined) return g.__dockSmartTest;
  if (process.env.VITEST) return null; // tests get the lexical search they were written for, unless they set one
  const products = indexOf(catalog);
  if (!products) return null;
  g.__dockSmart ??= new Map();
  let h = g.__dockSmart.get(products);
  if (!h) {
    h = build(products);
    g.__dockSmart.set(products, h);
  }
  return (await h).search;
}

export async function smartSearchStatus(catalog: unknown): Promise<SmartStatus> {
  const products = indexOf(catalog);
  if (g.__dockSmartTest) return { on: true, judge: true, reason: "test" };
  if (!products) return { on: false, reason: "not the partner catalogue", judge: false };
  await smartSearchFor(catalog);
  return (await g.__dockSmart!.get(products)!).status;
}

/** For tests: this smart search for every catalogue (null: lexical only; undefined: back to normal). */
export function setSmartSearchForTests(s: SmartSearch | null | undefined): void {
  g.__dockSmartTest = s;
}

/**
 * Find products for a request. Smart search with the partner catalogue; the catalogue's own search otherwise, so
 * every caller can use this one function on any catalogue.
 */
export async function findProducts(catalog: Pick<CatalogPort, "searchProducts">, req: FindRequest): Promise<FindResult> {
  const t0 = performance.now();
  const smart = req.text.trim() ? await smartSearchFor(catalog).catch(() => null) : null;
  if (smart) {
    try {
      return await smart.find(req);
    } catch (err) {
      console.error(`smart search failed, lexical answers: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    }
  }
  const products: Product[] = await catalog.searchProducts({
    ...(req.text.trim() ? { text: req.text } : {}),
    ...(req.category ?? req.need?.category ? { category: req.category ?? req.need?.category } : {}),
    ...(req.requiredClaims?.length ? { attributes: req.requiredClaims } : {}),
    ...(req.forbiddenAllergens?.length ? { forbiddenAllergens: req.forbiddenAllergens } : {}),
    ...(req.ids ? { ids: req.ids } : {}),
    limit: Math.min(req.limit ?? 24, 100),
  });
  const hits: FoundProduct[] = products.map((product) => ({ product, sources: ["lexical"] }));
  return { hits, path: "lexical", notes: [], applied: { claims: req.requiredClaims ?? [], forbiddenAllergens: req.forbiddenAllergens ?? [] }, onlyStandins: false, notSold: false, unsure: false, stats: { candidates: hits.length, ms: Math.round(performance.now() - t0) } };
}

/** The core's port (core/catalog/finder.ts) over findProducts, for the intake. */
export function finderFor(catalog: Pick<CatalogPort, "searchProducts">): ProductFinder {
  return { find: (req) => findProducts(catalog, req) };
}
