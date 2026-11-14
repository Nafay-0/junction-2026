/**
 * Head-to-head evaluation of product search on the real index: the same requests through every configuration.
 *
 *   pnpm search:eval                       every configuration, every case (fresh answers are cached for re-runs)
 *   pnpm search:eval --tune                leave the 30 hold-out cases out (while tuning)
 *   pnpm search:eval --only holdout        only the hold-out cases
 *   pnpm search:eval --configs kw,hybrid4,judge100     some configurations
 *   pnpm search:eval --fresh               ignore cached model answers (re-measures time and cost)
 *   pnpm search:eval --opus                also the reference re-ranking by Claude Opus 5.5 (about 2 cents a case; not for shipping)
 *   pnpm search:eval --sample 60           every k-th case only, 60 in all (spread over the set; for the Opus reference)
 *   pnpm search:eval --ablation            what recall is made of: each source alone and each one left out
 *   pnpm search:eval --recall opensearch   recall's keyword and vector lists from OpenSearch (OPENSEARCH_URL,
 *                                          --recall-index, default dock-recall; --recall-timeout ms, default 400),
 *                                          memory recall as the fallback; the table counts the fallbacks
 *   pnpm search:eval --literal-claims      count a claim as dropped when the label is missing, whatever the data shows
 *
 * Configurations:
 *   kw          keywords only: today's search (core/catalog/search.ts)
 *   vec         semantic vectors only (under the same hard filter)
 *   hybrid      keywords + semantic, fused, no judge
 *   hybrid4     keywords + semantic + the knowledge map's kinds and uses, no judge
 *   judge50/100/200   hybrid4 with the Decisions judge at that recall size
 *   kwjudge50   keyword recall only (lexical, typo, words), 50 candidates, judged: "find a lot, then filter"
 *   vecjudge50  semantic recall only, 50 candidates, judged
 *   opus50      judge50's 50 candidates re-ranked by Claude Opus 5.5 (reference, not for shipping)
 *
 * Common-practice baselines, on OpenSearch (--baselines; OPENSEARCH_URL or --baselines-url; --baselines-index, default
 * dock-recall: the index pnpm search:publish:opensearch creates). The buyer's words as typed, no reading of them:
 *   bm25              a plain multi_match (best_fields, OR) with OpenSearch's default BM25 (k1 1.2, b 0.75) over
 *                     names.fi (finnish analyzer), names.sv (swedish), names.en (english) and brand (lowercase, ascii
 *                     folding); no synonyms, no filters, no rules, no judge
 *   knn               k-NN alone: the query embedding against the same 768-d product vectors (Lucene HNSW, cosine)
 *   hybrid_rrf        bm25 and knn, 100 each, fused by reciprocal rank (k = 60, equal weights): no rules, no judge
 *   bm25_rules, hybrid_rrf_rules   the same lists with our hard rules applied in code afterwards (claims and
 *                     allergens read from the words, recall.ts hardFilter): what the rules add without a judge
 *
 * Timing: every embedding and judge answer is cached on disk (.data/search-eval/) with the time it took when it was
 * fetched; a cached answer replays that measured time, so a re-run reports the same latency without paying again.
 * Prints ids and figures only. Partner text never leaves .data/.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateText, Output } from "ai";
import { z } from "zod";
import { LexicalSearch, allergenEvidence, subjectOfIndexed } from "@/core/catalog/search";
import { claimEvidence } from "@/core/claim-evidence";
import type { IndexedProduct } from "@/core/catalog/partner";
import { createModel } from "@/server/agent/models";
import { costOf, tokensFromUsage, priceOf } from "@/server/agent/pricing";
import { KnowledgeMap } from "@/server/knowledge/map";
import { loadKnowledgeFile, resolveKnowledgeFile } from "@/server/knowledge/store";
import { judgeLine } from "@/server/search/docs";
import { SmartSearch, type Detailed, type SmartConfig } from "@/server/search/finder";
import { EMBED_USD_PER_M, embedTexts, queryPrompt } from "@/server/search/gemini";
import { DecisionsJudge, LEVELS, RUBRIC, judgeContext, type JudgeInput, type JudgeOutput, type RelevanceJudge, type Verdict } from "@/server/search/judge";
import { SearchIndex, type Signals } from "@/server/search/recall";
import { RecallRouter } from "@/server/search/recall-router";
import { OpenSearchRecall } from "@/server/aiven/search/opensearch-recall";
import { loadVectorsFile, resolveVectorsFile } from "@/server/search/vectors";
import { loadCatalogIndex } from "@/server/valio/index-store";
import { loadLocalEnv } from "../../scripts/lib/env";
import { SEARCH_CASES, type SearchCase } from "./cases";
import { isRight, isStandin, loadTruth } from "./check-cases";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const arg = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const CACHE = path.join(process.cwd(), ".data", "search-eval");
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
function cached<T>(kind: string, keyText: string, fresh: boolean, make: () => Promise<T>): Promise<{ v: T; hit: boolean }> {
  const dir = path.join(CACHE, kind);
  const f = path.join(dir, `${hash(keyText)}.json`);
  if (!fresh && existsSync(f)) return Promise.resolve({ v: JSON.parse(readFileSync(f, "utf8")) as T, hit: true });
  return make().then((v) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(f, JSON.stringify(v));
    return { v, hit: false };
  });
}

type Row = {
  case: SearchCase;
  config: string;
  top: string[];
  labels: (string | undefined)[];
  candidates: string[];
  ms: number;
  costUsd: number;
  path: string;
  notSoldSaid: boolean;
  unsure?: boolean;
  recallMs?: number;
  recallBackend?: string;
};

async function main() {
  loadLocalEnv();
  const fresh = flag("fresh");
  const loaded = loadCatalogIndex();
  if (!loaded) throw new Error("No catalogue index (pnpm index:build).");
  const products = loaded.index.products;
  const ksrc = await resolveKnowledgeFile();
  if (ksrc.from === "none") throw new Error(ksrc.reason);
  const kdata = loadKnowledgeFile(ksrc.file);
  const map = new KnowledgeMap(products, kdata);
  const vsrc = await resolveVectorsFile();
  if (vsrc.from === "none") throw new Error(vsrc.reason);
  const vectors = loadVectorsFile(vsrc.file);
  await loadTruth(); // registers the map's profiles for allergens by nature, as the server does
  const index = new SearchIndex(products, map, vectors);
  const slugOfKind = new Map(kdata.kinds.map((k) => [k.key, k.slug]));
  const slugById = new Map(kdata.profiles.map((p) => [p.id, slugOfKind.get(p.kind)]));
  const kindSlugOf = (id: string) => slugById.get(id);
  const byId = new Map(products.map((p) => [p.id, p]));
  const lexical = new LexicalSearch(products);

  let cases = SEARCH_CASES;
  if (flag("tune")) cases = cases.filter((c) => !c.holdout);
  if (arg("only") === "holdout") cases = cases.filter((c) => c.holdout);
  if (arg("case")) cases = cases.filter((c) => c.id === arg("case"));
  if (arg("sample")) {
    const k = Math.max(1, Math.floor(cases.length / Number(arg("sample"))));
    cases = cases.filter((_, i) => i % k === 0).slice(0, Number(arg("sample")));
  }

  // Query embeddings, measured once per text (fresh), replayed from the cache.
  const embedCache = new Map<string, { vector: number[]; tokens: number; ms: number }>();
  const embed = async (text: string) => {
    const r = await cached("embed", `${text}`, fresh, async () => {
      const t0 = performance.now();
      const e = await embedTexts([queryPrompt(text)], vectors.meta.dim, 10_000);
      return { vector: [...e.vectors[0]], tokens: e.tokens, ms: Math.round(performance.now() - t0) };
    });
    embedCache.set(text, r.v);
    return r.v;
  };
  // The judge, cached by its exact input.
  const decisions = new DecisionsJudge();
  class CachedJudge implements RelevanceJudge {
    readonly name = decisions.name;
    async judge(input: JudgeInput, timeoutMs: number): Promise<JudgeOutput> {
      const r = await cached("judge", JSON.stringify([judgeContext(input), input.candidates, RUBRIC]), fresh, async () => {
        const o = await decisions.judge(input, 15_000);
        return { verdicts: [...o.verdicts.entries()], tokens: o.tokens, costUsd: o.costUsd, ms: o.ms, model: o.model };
      });
      if (r.v.ms > timeoutMs) {
        judgeLate++;
        throw new Error(`late (${r.v.ms} ms > ${timeoutMs} ms)`);
      }
      return { ...r.v, verdicts: new Map(r.v.verdicts as [string, Verdict][]) };
    }
  }
  let judgeLate = 0;
  const judgeTimeout = Number(arg("judge-timeout") ?? 800);

  const recallOn = arg("recall") ?? "memory";
  const osUrl = process.env.OPENSEARCH_URL?.trim();
  if (recallOn === "opensearch" && !osUrl) throw new Error("--recall opensearch needs OPENSEARCH_URL");
  const recallTimeout = Number(arg("recall-timeout") ?? 400);
  const router =
    recallOn === "opensearch"
      ? new RecallRouter(index, new OpenSearchRecall({ url: osUrl, index: arg("recall-index") ?? "dock-recall", timeoutMs: recallTimeout + 200 }), { primary: "opensearch", timeoutMs: recallTimeout })
      : undefined;
  if (router) {
    // A deployed server's connection and the index's HNSW graph are warm; a laptop's first calls are not (TLS, the
    // graph read from disk: 600 to 900 ms each on 14 Nov). Three calls before the run, not counted.
    const warm = new OpenSearchRecall({ url: osUrl, index: arg("recall-index") ?? "dock-recall", timeoutMs: 10_000 });
    const v = new Float32Array(vectors.meta.dim).fill(1 / Math.sqrt(vectors.meta.dim));
    for (let i = 0; i < 3; i++) await warm.lists({ claims: [], forbiddenAllergens: [] }, { lexical: { terms: ["milk"], mode: "and", limit: 10 }, vectors: { k: 60 } }, { queryVector: v }).catch(() => undefined);
    console.log(`recall: OpenSearch (${arg("recall-index") ?? "dock-recall"}), ${recallTimeout} ms deadline, memory as the fallback (warmed up with 3 calls)`);
  }
  const smart = new SmartSearch({
    index,
    ...(router ? { recall: router } : {}),
    judge: new CachedJudge(),
    embed: async (text) => {
      const e = await embed(text);
      return { vector: Float32Array.from(e.vector), tokens: e.tokens, cached: false };
    },
    config: { judgeTimeoutMs: judgeTimeout },
  });

  const run = async (c: SearchCase, name: string, cfg: Partial<SmartConfig>): Promise<Row> => {
    const r: Detailed = await smart.findDetailed({ text: c.text, limit: 24 }, cfg);
    const embedMs = cfg.signals?.vectors === false ? 0 : (embedCache.get(c.text)?.ms ?? 0);
    const computeMs = r.stats.ms - (r.stats.embedMs ?? 0) - (r.stats.judgeMs ?? 0);
    const judgeMs = r.path === "judge" ? (r.stats.judgeMs ?? 0) : r.reason?.startsWith("judge late") ? judgeTimeout : 0;
    const embedTokens = cfg.signals?.vectors === false ? 0 : (embedCache.get(c.text)?.tokens ?? 0);
    return {
      case: c,
      config: name,
      top: r.hits.map((h) => h.product.id),
      labels: r.hits.map((h) => h.label),
      candidates: r.candidates.map((x) => x.id),
      ms: Math.round(computeMs + embedMs + judgeMs),
      costUsd: (embedTokens * EMBED_USD_PER_M) / 1e6 + (r.path === "judge" ? (r.stats.tokens ?? 0) - embedTokens : 0) * 1e-7,
      path: r.path + (r.reason ? ` (${r.reason})` : ""),
      notSoldSaid: r.notSold || (r.path !== "judge" && r.hits.length === 0),
      unsure: r.unsure,
      recallMs: r.stats.recallMs,
      recallBackend: r.stats.recallBackend + (r.stats.recallFallback ? ` (fallback: ${r.stats.recallFallback})` : ""),
    };
  };

  const noJudge = { judge: false };
  const S = (s: Signals): Signals => ({ lexical: false, typo: false, words: false, kinds: false, vectors: false, code: false, ...s });
  const CONFIGS: Record<string, (c: SearchCase) => Promise<Row>> = {
    kw: async (c) => {
      const t0 = performance.now();
      const hits = lexical.search({ text: c.text, limit: 100 });
      const ms = performance.now() - t0;
      return { case: c, config: "kw", top: hits.slice(0, 24).map((h) => h.product.id), labels: [], candidates: hits.map((h) => h.product.id), ms: Math.round(ms), costUsd: 0, path: "lexical", notSoldSaid: hits.length === 0 };
    },
    vec: (c) => run(c, "vec", { ...noJudge, recallSize: 100, signals: S({ vectors: true }) }),
    hybrid: (c) => run(c, "hybrid", { ...noJudge, recallSize: 100, signals: S({ lexical: true, typo: true, words: true, vectors: true, code: true }) }),
    hybrid4: (c) => run(c, "hybrid4", { ...noJudge, recallSize: 100 }),
    hybrid4_50: (c) => run(c, "hybrid4_50", { ...noJudge, recallSize: 50 }),
    kwjudge50: (c) => run(c, "kwjudge50", { recallSize: 50, signals: S({ lexical: true, typo: true, words: true, code: true }) }),
    vecjudge50: (c) => run(c, "vecjudge50", { recallSize: 50, signals: S({ vectors: true, code: true }) }),
    judge50: (c) => run(c, "judge50", { recallSize: 50 }),
    judge100: (c) => run(c, "judge100", { recallSize: 100 }),
    judge200: (c) => run(c, "judge200", { recallSize: 200 }),
  };
  if (flag("baselines")) {
    const { Client } = await import("@opensearch-project/opensearch");
    const url = arg("baselines-url") ?? process.env.OPENSEARCH_URL?.trim();
    if (!url) throw new Error("--baselines needs OPENSEARCH_URL or --baselines-url (a local Docker OpenSearch with pnpm search:publish:opensearch)");
    const os = new Client({ node: url, requestTimeout: 10_000, maxRetries: 0 });
    const ix = arg("baselines-index") ?? "dock-recall";
    const ids = (body: unknown) => ((body as { hits?: { hits?: { _id: string }[] } }).hits?.hits ?? []).map((h) => h._id);
    const bm25 = async (text: string) => ids((await os.search({ index: ix, body: { size: 100, _source: false, query: { multi_match: { query: text, fields: ["names.fi", "names.sv", "names.en", "brand"] } } } })).body);
    const knn = async (vector: number[]) => ids((await os.search({ index: ix, body: { size: 100, _source: false, query: { knn: { vec: { vector, k: 100 } } } } })).body);
    const rrf = (lists: string[][]) => {
      const score = new Map<string, number>();
      for (const l of lists) l.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + rank + 1)));
      return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
    };
    const rules = (text: string, list: string[]) => {
      const f = index.hardFilter(index.understand(text));
      return list.filter((id) => f(byId.get(id)!));
    };
    const baseline = (name: string, make: (c: SearchCase) => Promise<{ list: string[]; embedMs: number; embedTokens: number }>, withRules = false) => async (c: SearchCase): Promise<Row> => {
      const t0 = performance.now();
      const got = await make(c);
      const list = withRules ? rules(c.text, got.list) : got.list;
      const ms = performance.now() - t0 + got.embedMs;
      return { case: c, config: name, top: list.slice(0, 24), labels: [], candidates: list, ms: Math.round(ms), costUsd: (got.embedTokens * EMBED_USD_PER_M) / 1e6, path: "baseline", notSoldSaid: list.length === 0 };
    };
    const lexOnly = async (c: SearchCase) => ({ list: await bm25(c.text), embedMs: 0, embedTokens: 0 });
    const vecOnly = async (c: SearchCase) => {
      const e = await embed(c.text);
      return { list: await knn(e.vector), embedMs: e.ms, embedTokens: e.tokens };
    };
    const both = async (c: SearchCase) => {
      const e = await embed(c.text);
      const [a, b] = await Promise.all([bm25(c.text), knn(e.vector)]);
      return { list: rrf([a, b]), embedMs: e.ms, embedTokens: e.tokens };
    };
    CONFIGS.bm25 = baseline("bm25", lexOnly);
    CONFIGS.knn = baseline("knn", vecOnly);
    CONFIGS.hybrid_rrf = baseline("hybrid_rrf", both);
    CONFIGS.bm25_rules = baseline("bm25_rules", lexOnly, true);
    CONFIGS.hybrid_rrf_rules = baseline("hybrid_rrf_rules", both, true);
  }
  if (flag("ablation")) {
    for (const s of ["lexical", "typo", "words", "kinds", "vectors"] as const) {
      const size = Number(arg("recall") ?? 50);
      CONFIGS[`only_${s}`] = (c) => run(c, `only_${s}`, { ...noJudge, recallSize: size, signals: S({ [s]: true, code: true }) });
      CONFIGS[`no_${s}`] = (c) => run(c, `no_${s}`, { ...noJudge, recallSize: size, signals: { [s]: false } });
    }
  }
  let opusUsd = 0;
  if (flag("opus")) {
    const { model } = createModel("anthropic:claude-opus-5-5");
    const schema = z.object({ verdicts: z.array(z.object({ n: z.number().int(), level: z.number().int().min(0).max(3) })) });
    CONFIGS.opus50 = async (c) => {
      const base = await smart.findDetailed({ text: c.text, limit: 24 }, { judge: false, recallSize: 50 });
      const cands = base.candidates.map((x) => x.id);
      const lines = cands.map((id, i) => `${i + 1}. ${judgeLine(byId.get(id)!, map)}`).join("\n");
      const prompt = `${judgeContext({ text: c.text, candidates: [] })}\n\nRate every product on this scale:\n${RUBRIC.map((r, i) => `${i}: ${r}`).join("\n")}\n\nProducts:\n${lines}\n\nAnswer with one verdict per product number.`;
      const r = await cached("opus", prompt, fresh, async () => {
        const t0 = performance.now();
        const out = await generateText({ model, output: Output.object({ schema }), prompt, maxRetries: 2 });
        const tokens = tokensFromUsage(out.usage);
        return { verdicts: (out.output as z.infer<typeof schema>).verdicts, ms: Math.round(performance.now() - t0), costUsd: costOf(tokens, priceOf("anthropic:claude-opus-5-5")) ?? 0 };
      });
      opusUsd += r.hit ? 0 : r.v.costUsd;
      const level = new Map(r.v.verdicts.map((v) => [cands[v.n - 1], v.level]));
      const order = cands.filter((id) => (level.get(id) ?? 0) > 0).sort((a, b) => (level.get(b) ?? 0) - (level.get(a) ?? 0) || cands.indexOf(a) - cands.indexOf(b));
      const anyMatch = order.some((id) => (level.get(id) ?? 0) >= 2);
      return { case: c, config: "opus50", top: order.slice(0, 24), labels: order.slice(0, 24).map((id) => LEVELS[level.get(id) ?? 0]), candidates: cands, ms: r.v.ms + (embedCache.get(c.text)?.ms ?? 0), costUsd: r.v.costUsd, path: "opus", notSoldSaid: !order.length, unsure: !anyMatch && order.length > 0 };
    };
  }
  const want = (arg("configs") ?? Object.keys(CONFIGS).join(",")).split(",");

  // Run: embeddings first (one per text), then each configuration, a few cases at a time.
  for (const c of cases) await embed(c.text);
  const rows: Row[] = [];
  for (const name of want) {
    const fn = CONFIGS[name];
    if (!fn) throw new Error(`unknown configuration ${name}`);
    const queue = [...cases];
    await Promise.all(
      Array.from({ length: name.startsWith("opus") ? 4 : 3 }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) rows.push(await fn(c));
      }),
    );
  }

  // ---------- score ----------
  const right = (c: SearchCase, id: string) => isRight(c, byId.get(id)!, kindSlugOf);
  const stand = (c: SearchCase, id: string) => isStandin(c, byId.get(id)!, kindSlugOf);
  // A stated claim missing, or a forbidden allergen not ruled out (contains, may contain, or no data and not fresh
  // whole produce by its nature: core/catalog/nature.ts, the server's rule).
  // A claim is met as the product rules meet it (core/claim-evidence.ts: the claim, or what the maker's data shows);
  // --literal-claims counts only the label, as before the evidence rule.
  const literal = process.argv.includes("--literal-claims");
  const violates = (c: SearchCase, p: IndexedProduct) => (c.claims ?? []).some((x) => (literal ? !p.claims.includes(x) : !claimEvidence(subjectOfIndexed(p), x).met)) || (c.allergenFree ?? []).some((a) => ["contains", "may_contain", "unknown"].includes(allergenEvidence(p, a)));
  type Score = { n: number; top1: number; top3: number; recall: number; dropped: number; standinAsMatch: number; notSold: number; notSoldN: number; ms: number[]; cost: number[]; judged: number; fallback: number };
  const score = (rs: Row[]): Score => {
    const s: Score = { n: 0, top1: 0, top3: 0, recall: 0, dropped: 0, standinAsMatch: 0, notSold: 0, notSoldN: 0, ms: [], cost: [], judged: 0, fallback: 0 };
    for (const r of rs) {
      const c = r.case;
      s.ms.push(r.ms);
      s.cost.push(r.costUsd);
      if (r.path === "judge") s.judged++;
      else if (/judge (late|over|refused|failed|HTTP|no answer)/.test(r.path) || (r.path.includes("(judge ") && !r.path.includes("judge off") && !r.path.includes("no candidates"))) s.fallback++;
      if (c.tags.includes("not_sold")) {
        s.notSoldN++;
        const presented = r.labels.some((l) => l !== undefined) ? r.top.some((_, i) => r.labels[i] === "exact" || r.labels[i] === "variant") : r.top.length > 0;
        if (!presented) s.notSold++;
        continue;
      }
      s.n++;
      const ok = (id: string, i: number) => (c.tags.includes("standin_only") ? stand(c, id) && r.labels[i] === "standin" : right(c, id));
      if (r.top[0] && ok(r.top[0], 0)) s.top1++;
      if (r.top.slice(0, 3).some((id, i) => ok(id, i))) s.top3++;
      if (r.candidates.some((id) => (c.tags.includes("standin_only") ? stand(c, id) : right(c, id)))) s.recall++;
      if ((c.claims?.length || c.allergenFree?.length) && r.top.slice(0, 3).some((id) => violates(c, byId.get(id)!))) {
        s.dropped++;
        if (flag("misses")) console.log(`DROPPED ${r.config} ${c.id}`);
      }
      if (r.top[0] && stand(c, r.top[0]) && r.labels[0] !== "standin") s.standinAsMatch++;
    }
    return s;
  };
  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
  };
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
  const line = (name: string, s: Score) =>
    `| ${name.padEnd(9)} | ${pct(s.top1, s.n).padStart(4)} | ${pct(s.top3, s.n).padStart(4)} | ${pct(s.recall, s.n).padStart(4)} | ${String(s.dropped).padStart(3)} | ${String(s.standinAsMatch).padStart(3)} | ${`${s.notSold}/${s.notSoldN}`.padStart(5)} | ${String(q(s.ms, 0.5)).padStart(5)} | ${String(q(s.ms, 0.9)).padStart(5)} | ${(s.cost.reduce((a, b) => a + b, 0) / Math.max(s.cost.length, 1) * 100).toFixed(3).padStart(6)} | ${s.fallback ? `${s.fallback}/${s.fallback + s.judged}` : "-"} |`;
  const header = "| config    | top1 | top3 | recl | drp | sam | nsold | p50ms | p90ms | cent/q | fallback |\n|---|---|---|---|---|---|---|---|---|---|---|";
  const table = (filter: (c: SearchCase) => boolean, title: string) => {
    console.log(`\n${title} (${cases.filter(filter).length} cases)\n${header}`);
    for (const name of want) console.log(line(name, score(rows.filter((r) => r.config === name && filter(r.case)))));
  };
  table(() => true, "All");
  table((c) => c.kind === "exact", "Exact product (name, brand, pack, code)");
  table((c) => c.kind === "recipe", "Recipe or ingredient");
  table((c) => c.kind === "describe", "Description of what it is or does");
  if (!flag("tune") && arg("only") !== "holdout") table((c) => !!c.holdout, "Hold-out only");
  table((c) => c.tags.includes("typo") || c.tags.includes("inflected") || c.tags.includes("mixed_language"), "Typos, inflections, mixed languages");
  table((c) => !!(c.claims?.length || c.brand || c.pack || c.allergenFree?.length), "Requests where a filter decides (claims, brand, pack, allergens)");
  console.log("\ntop1/top3: right product first / in the first three (stand-in-only cases: a stand-in, labelled as one). recl: right product among the candidates the ranking saw. drp: requirements dropped (a top-3 product without a stated claim or with a forbidden allergen). sam: a stand-in shown first as if it were the match. nsold: \"we do not sell that\" said for things not sold. cent/q: US cents per search. fallback: searches the judge did not answer in time.");
  if (judgeLate) console.log(`judge answers over the ${judgeTimeout} ms deadline: ${judgeLate}`);
  for (const name of want) {
    const rs = rows.filter((r) => r.config === name && r.recallMs !== undefined);
    if (!rs.length) continue;
    const by = new Map<string, number>();
    for (const r of rs) by.set(r.recallBackend ?? "?", (by.get(r.recallBackend ?? "?") ?? 0) + 1);
    console.log(`recall ${name}: p50 ${q(rs.map((r) => r.recallMs!), 0.5)} ms, p90 ${q(rs.map((r) => r.recallMs!), 0.9)} ms; answered by ${[...by.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  if (router) console.log(`router: ${JSON.stringify(router.stats())}`);
  if (opusUsd) console.log(`Opus reference spend this run: $${opusUsd.toFixed(3)}`);

  // Misses, for tuning: ids only.
  if (flag("misses")) {
    const name = arg("misses-of") ?? want.at(-1)!;
    for (const r of rows.filter((x) => x.config === name)) {
      const c = r.case;
      if (c.tags.includes("not_sold")) {
        if (r.labels.some((l) => l !== undefined) ? r.top.some((_, i) => r.labels[i] === "exact" || r.labels[i] === "variant") : r.top.length) console.log(`MISS ${c.id} [not sold, presented] top=${r.top.slice(0, 3).map((id) => `${id}:${kindSlugOf(id)}:${r.labels[r.top.indexOf(id)] ?? ""}`).join(" ")}`);
        continue;
      }
      const ok = c.tags.includes("standin_only") ? r.top[0] && stand(c, r.top[0]) && r.labels[0] === "standin" : r.top[0] && right(c, r.top[0]);
      if (!ok) console.log(`MISS ${c.id} recall=${r.candidates.some((id) => (c.tags.includes("standin_only") ? stand(c, id) : right(c, id)))} path=${r.path} top=${r.top.slice(0, 3).map((id, i) => `${id}:${kindSlugOf(id)}:${r.labels[i] ?? ""}`).join(" ")}`);
    }
  }
  const out = path.join(CACHE, "last-run.json");
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(out, JSON.stringify(rows.map((r) => ({ ...r, case: r.case.id })), null, 0));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
