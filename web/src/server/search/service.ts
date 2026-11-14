import { nutritionFindings } from "@/core/nutrition";
import type { CatalogPort, Product } from "@/core/catalog";
import type { FindRequest, FindResult, FoundProduct, ProductFinder } from "@/core/catalog/finder";
import type { IndexedProduct } from "@/core/catalog/partner";
import { admitSearchCall, recordLlmSpend } from "@/server/limits";
import { getKnowledgeMap } from "@/server/knowledge/service";
import { SmartSearch, type SearchCall, type SmartConfig } from "./finder";
import { EMBED_MODEL, embedTexts, geminiKey, queryPrompt, warmGemini } from "./gemini";
import { DecisionsJudge, type RelevanceJudge } from "./judge";
import { metrics } from "@/server/aiven/metrics";
import { SearchIndex } from "./recall";
import { RecallRouter, type RecallBackendName, type RecallRouterStats } from "./recall-router";
import { emitSearchEvent } from "./telemetry";
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
 *   DOCK_SEARCH_RECALL_BACKEND       "memory" (default) or "opensearch": which recall backend answers first, the other
 *                                    is the fallback (recall-router.ts); OpenSearch needs OPENSEARCH_URL and, for the
 *                                    fallback role, the OpenSearch adapter on (DOCK_SEARCH=opensearch or DOCK_AIVEN=1)
 *   DOCK_SEARCH_RECALL_TIMEOUT_MS    OpenSearch recall's deadline (default 400)
 *   DOCK_SEARCH_RECALL_INDEX         the OpenSearch index or alias with the vectors (default dock-recall)
 *   DOCK_SEARCH_RECALL_BACKEND=memory-only   never ask OpenSearch, even with OPENSEARCH_URL set
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

export type SmartStatus = { on: boolean; reason?: string; vectors?: { count: number; dim: number; model: string; from: string }; judge: boolean; recall?: RecallRouterStats & { index?: string } };

type Holder = { search: SmartSearch | null; status: SmartStatus; products: IndexedProduct[]; router?: RecallRouter; recallIndex?: string };
const g = globalThis as typeof globalThis & { __dockSmart?: Map<IndexedProduct[], Promise<Holder>>; __dockReady?: Set<IndexedProduct[]>; __dockSmartTest?: SmartSearch | null; __dockSmartHolders?: Holder[] };

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

/** The OpenSearch side of recall, when OPENSEARCH_URL is set (Aiven Runtime injects OPENSEARCH_URI; env.ts copies it). */
async function openSearchRecall(): Promise<{ lists: import("./recall-router").ListsSource; index: string; ready: boolean } | undefined> {
  const url = envValue("OPENSEARCH_URL") ?? envValue("OPENSEARCH_URI");
  const backend = envValue("DOCK_SEARCH_RECALL_BACKEND");
  if (!url || backend === "memory-only") return undefined;
  // Asked for by name, or the OpenSearch adapter is on (DOCK_SEARCH=opensearch or DOCK_AIVEN=1, as deployed): a laptop
  // with only the address in .env.local does not send searches to the hosted service.
  const { openSearchAdapterOn } = await import("@/server/aiven/search/event-index");
  if (backend !== "opensearch" && !envValue("DOCK_SEARCH_RECALL_INDEX") && !openSearchAdapterOn()) return undefined;
  const { OpenSearchRecall, RECALL_ALIAS } = await import("@/server/aiven/search/opensearch-recall");
  const index = envValue("DOCK_SEARCH_RECALL_INDEX") ?? RECALL_ALIAS;
  const timeoutMs = num("DOCK_SEARCH_RECALL_TIMEOUT_MS", 400);
  const lists = new OpenSearchRecall({ url, index, timeoutMs: timeoutMs + 200 });
  // Not published yet (or unreachable): still the fallback, but this process waits for its own vectors at boot as before.
  const ready = (await lists.health()).ok;
  return { lists, index, ready };
}

async function build(products: IndexedProduct[]): Promise<Holder> {
  const testing = !!process.env.VITEST;
  if (envValue("DOCK_SMART_SEARCH") === "off") return { search: null, status: { on: false, reason: "DOCK_SMART_SEARCH=off", judge: false }, products };
  const remote = testing ? undefined : await openSearchRecall().catch(() => undefined);
  let vectors: ProductVectors | null = null;
  let vfrom = "none";
  const loadVectors = async () => {
    const src = await resolveVectorsFile();
    if (src.from === "none") return;
    try {
      vectors = loadVectorsFile(src.file);
      vfrom = src.from;
    } catch (err) {
      console.error(`search vectors not loaded: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    }
  };
  // With OpenSearch as a recall backend the vectors load after the index is built, so the first searches after a
  // deploy are answered semantically by OpenSearch while this process is still reading its copy.
  if (!testing && !remote?.ready) await loadVectors();
  const map = await getKnowledgeMap().catch(() => null);
  const index = new SearchIndex(products, map, vectors);
  const keyed = !testing && !!geminiKey();
  const judgeOn = keyed && envValue("DOCK_SEARCH_JUDGE") !== "off";
  const judge: RelevanceJudge | undefined = judgeOn ? new DecisionsJudge() : undefined;
  if (keyed) warmGemini(); // a warm connection before the first search
  const config: Partial<SmartConfig> = { recallSize: num("DOCK_SEARCH_RECALL", 50), judgeTimeoutMs: num("DOCK_SEARCH_JUDGE_TIMEOUT_MS", 800), embedTimeoutMs: num("DOCK_SEARCH_EMBED_TIMEOUT_MS", 700), judge: judgeOn };
  const primary: RecallBackendName = envValue("DOCK_SEARCH_RECALL_BACKEND") === "opensearch" ? "opensearch" : "memory";
  const router = new RecallRouter(index, remote?.lists, {
    primary,
    timeoutMs: num("DOCK_SEARCH_RECALL_TIMEOUT_MS", 400),
    onAnswer: (a) => {
      metrics.inc(a.backend === "opensearch" ? "recall.opensearch" : "recall.memory");
      if (a.fallback) metrics.inc("recall.fallback");
    },
  });
  const embed = keyed && (vectors || remote) ? embedder((vectors as ProductVectors | null)?.meta.dim ?? 768) : undefined;
  const search = new SmartSearch({ index, ...(judge ? { judge } : {}), ...(embed ? { embed } : {}), config, admit: () => admitSearchCall(), observe, recall: router, done: (req, r) => emitSearchEvent(req, r) });
  const status = (): SmartStatus => {
    const v = index.vectors;
    return {
      on: true,
      judge: judgeOn,
      ...(v ? { vectors: { count: v.size, dim: v.meta.dim, model: v.meta.model ?? EMBED_MODEL, from: vfrom } } : {}),
      recall: { ...router.stats(), ...(remote ? { index: remote.index } : {}) },
      ...(!map ? { reason: "no knowledge map: kinds and uses are not used" } : !v && !remote ? { reason: "no search vectors: semantic recall is off (pnpm search:vectors)" } : !v ? { reason: "vectors not in memory (yet): semantic recall is answered by OpenSearch" } : !keyed ? { reason: "GEMINI_API_KEY not set: no judge, no query embedding" } : {}),
    };
  };
  const holder: Holder = { search, get status() { return status(); }, products, router, ...(remote ? { recallIndex: remote.index } : {}) };
  if (!testing && remote?.ready) {
    void loadVectors().then(() => {
      if (vectors) index.attachVectors(vectors);
    });
  }
  return holder;
}

/** How recall was answered in this process: the order, counts per backend, fallbacks (for /api/health and the Platform page). */
export function recallStats(): (RecallRouterStats & { index?: string }) | undefined {
  for (const h of g.__dockSmartHolders ?? []) if (h.router) return { ...h.router.stats(), ...(h.recallIndex ? { index: h.recallIndex } : {}) };
  return undefined;
}

/** The partner index a catalogue searches, when it is (or wraps) the partner's catalogue. */
function indexOf(catalog: unknown): { products: IndexedProduct[] } | undefined {
  let c = catalog as { index?: { products?: IndexedProduct[] }; inner?: unknown } | undefined;
  for (let i = 0; c && i < 4; i++) {
    if (c.index?.products && Array.isArray(c.index.products)) return { products: c.index.products };
    c = c.inner as typeof c;
  }
  return undefined;
}

/**
 * Smart search over this catalogue, or null when it is not the partner's (or smart search is off). Built once per
 * process (about 3 s: the vectors, the knowledge map's kinds, the word lists); the runtime starts it at boot.
 * `ifReady`: do not wait for the build; null until it is done (the intake's best-effort recall uses this).
 */
export async function smartSearchFor(catalog: unknown, opts: { ifReady?: boolean } = {}): Promise<SmartSearch | null> {
  if (g.__dockSmartTest !== undefined) return g.__dockSmartTest;
  if (process.env.VITEST) return null; // tests get the lexical search they were written for, unless they set one
  const found = indexOf(catalog);
  if (!found) return null;
  g.__dockSmart ??= new Map();
  g.__dockReady ??= new Set();
  let h = g.__dockSmart.get(found.products);
  if (!h) {
    const products = found.products;
    h = build(products);
    void h.then(
      (built) => {
        g.__dockReady!.add(products);
        (g.__dockSmartHolders ??= []).push(built);
      },
      () => {},
    );
    g.__dockSmart.set(products, h);
  }
  if (opts.ifReady && !g.__dockReady.has(found.products)) return null;
  return (await h).search;
}

export async function smartSearchStatus(catalog: unknown): Promise<SmartStatus> {
  const found = indexOf(catalog);
  if (g.__dockSmartTest) return { on: true, judge: true, reason: "test" };
  if (!found) return { on: false, reason: "not the partner catalogue", judge: false };
  await smartSearchFor(catalog);
  return (await g.__dockSmart!.get(found.products)!).status;
}

/** For tests: this smart search for every catalogue (null: lexical only; undefined: back to normal). */
export function setSmartSearchForTests(s: SmartSearch | null | undefined): void {
  g.__dockSmartTest = s;
}

/**
 * Find products for a request. Smart search with the partner catalogue; the catalogue's own search otherwise, so
 * every caller can use this one function on any catalogue.
 */
export async function findProducts(catalog: Pick<CatalogPort, "searchProducts">, req: FindRequest, opts: { ifReady?: boolean } = {}): Promise<FindResult> {
  const r = await findRaw(catalog, req, opts);
  return req.nutritionRules?.length ? withNutritionRules(r, req.nutritionRules) : r;
}

/** The kitchen's nutrition rules on a result: what breaks one (or declares no figure) moves out, with the rule and its figure. */
function withNutritionRules(r: FindResult, rules: NonNullable<FindRequest["nutritionRules"]>): FindResult {
  const outside: NonNullable<FindResult["outsideRules"]> = [];
  const hits = r.hits.filter((h) => {
    const p = h.product;
    const f = nutritionFindings(rules, { productId: p.id, category: p.category, nutrition: p.nutrition })[0];
    if (!f) return true;
    outside.push({ productId: p.id, name: p.name, rule: "nutrition_rules", reason: f.reason.replace(new RegExp(`^${p.id} `), `${p.name} `), details: { nutrient: f.rule.nutrient, problem: f.problem, ...(f.value !== undefined ? { value: f.value } : {}), ...(f.rule.max !== undefined ? { max: f.rule.max } : {}), ...(f.rule.min !== undefined ? { min: f.rule.min } : {}), per: p.nutrition?.per ?? "100g", ...(f.rule.categories?.length ? { kinds: f.rule.categories } : {}) } });
    return false;
  });
  return { ...r, hits, ...(outside.length ? { outsideRules: outside } : {}) };
}

async function findRaw(catalog: Pick<CatalogPort, "searchProducts">, req: FindRequest, opts: { ifReady?: boolean } = {}): Promise<FindResult> {
  const t0 = performance.now();
  const smart = req.text.trim() ? await smartSearchFor(catalog, opts).catch(() => null) : null;
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
export function finderFor(catalog: Pick<CatalogPort, "searchProducts">, opts: { ifReady?: boolean } = {}): ProductFinder {
  return { find: (req) => findProducts(catalog, req, opts) };
}

/** Start building smart search now (at boot), so no request waits for it. Never throws; not under tests or a build. */
export function warmSmartSearch(catalog: unknown): void {
  if (process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build" || envValue("DOCK_SMART_SEARCH") === "off") return;
  void smartSearchFor(catalog).catch(() => {});
}
