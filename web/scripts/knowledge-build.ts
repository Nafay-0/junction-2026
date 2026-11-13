/**
 * Build the product knowledge map: what every product is in a kitchen's terms, from a language model reading the
 * partner's product text in batches. Hard facts (dietary claims, allergens, origin, labels, nutrition) are not
 * asked of the model; they stay in the catalogue index and are joined at load time.
 *
 *   pnpm knowledge:build                          all categories, default model, in-process calls
 *   pnpm knowledge:build --categories 10400,10401 only these partner categories (pilot)
 *   pnpm knowledge:build --model openai:gpt-6-luna --effort off
 *   pnpm knowledge:build --executor modal         run the uncached calls as parallel Modal jobs, then finish locally
 *   pnpm knowledge:build --plan                   count the calls and estimate the cost, call nothing
 *
 * Every answer is cached on disk by the hash of its request (.data/valio/knowledge-cache/), so a rerun is free and
 * an interrupted build resumes. Output: .data/valio/knowledge-map.json.gz (git-ignored; partner-derived).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { IndexedProduct } from "@/core/catalog/partner";
import { costOf, priceOf } from "@/server/agent/pricing";
import { DiskCache, runAll, specKey, spendOf, type CachedAnswer, type Effort, type LlmSpec } from "@/server/knowledge/build/llm";
import { modelInput, nameLine } from "@/server/knowledge/build/inputs";
import { PROFILE_SYSTEM, TAXONOMY_SCHEMA, TAXONOMY_SYSTEM, profileSchema, profileUser, taxonomyUser, type ProfileAnswer, type TaxonomyAnswer } from "@/server/knowledge/build/prompts";
import { defaultKnowledgePath, knowledgeCacheDir } from "@/server/knowledge/store";
import { encodeKnowledge, profileFromAnswer, type KindDef, type KnowledgeData, type Profile } from "@/server/knowledge/types";
import { isFamily } from "@/server/knowledge/vocab";
import { loadCatalogIndex, valioDataDir } from "@/server/valio/index-store";
import { env, loadLocalEnv } from "./lib/env";

const PRODUCT_FILE = "valio_aimo_junction26_product_data.json";
/** Chosen on the pilot (11 categories, 929 products): see docs/knowledge-map.md. */
const DEFAULT_MODEL = "openai:gpt-6-luna";
const BATCH = 25;
const RETRY_BATCH = 6;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "other";

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function answerAll(specs: LlmSpec[], cache: DiskCache, label: string, executor: string, concurrency: number) {
  if (executor === "modal") runOnModal(specs, cache, label);
  const t0 = Date.now();
  let last = 0;
  const r = await runAll(specs, cache, {
    concurrency,
    onProgress: (done, total, s) => {
      if (Date.now() - last > 5000 || done === total) {
        last = Date.now();
        console.log(`  ${label}: ${done}/${total} new calls, $${s.costUsd.toFixed(3)} so far, ${s.failed} failed, ${Math.round((Date.now() - t0) / 1000)} s`);
      }
    },
    onError: (_s, e) => console.warn(`  ${label}: call failed: ${e.slice(0, 200)}`),
  });
  console.log(`  ${label}: ${specs.length} requests, ${r.stats.cached} from cache, ${r.stats.calls} called ($${r.stats.costUsd.toFixed(3)}), ${r.stats.failed} failed, ${Math.round(r.stats.ms / 1000)} s`);
  return r.answers;
}

/** Hand the uncached specs to Modal as one JSONL file and fold the answers into the cache. */
function runOnModal(specs: LlmSpec[], cache: DiskCache, label: string) {
  const todo = specs.map((s) => ({ s, key: specKey(s) })).filter(({ key }) => !cache.has(key));
  if (!todo.length) return;
  const dir = path.join(cache.dir, "..", "modal-io");
  mkdirSync(dir, { recursive: true });
  const stamp = `${label}-${Date.now()}`;
  const inFile = path.join(dir, `${stamp}.in.jsonl`);
  const outFile = path.join(dir, `${stamp}.out.jsonl`);
  writeFileSync(inFile, todo.map(({ s, key }) => JSON.stringify({ key, spec: s })).join("\n"));
  const script = path.join(process.cwd(), "scripts", "knowledge", "modal_exec.py");
  console.log(`  ${label}: ${todo.length} calls to Modal…`);
  const t0 = Date.now();
  // A pinned client run through uvx, so the build does not depend on whichever Modal CLI the machine has installed.
  const [cmd, ...pre] = (env("KNOWLEDGE_MODAL_CMD") ?? "uvx --python 3.12 --from modal==1.6.4 modal").split(" ");
  execFileSync(cmd, [...pre, "run", script, "--infile", inFile, "--outfile", outFile], { stdio: "inherit", env: process.env });
  let ok = 0;
  for (const line of readFileSync(outFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const a = JSON.parse(line) as CachedAnswer & { error?: string };
    if (a.error || !a.output || typeof a.output !== "object" || !a.tokens) continue;
    cache.put({ ...a, costUsd: costOf(a.tokens, priceOf(a.model)), via: "modal" });
    ok++;
  }
  console.log(`  ${label}: Modal answered ${ok}/${todo.length} in ${Math.round((Date.now() - t0) / 1000)} s; the rest run locally`);
}

async function main() {
  loadLocalEnv();
  const model = arg("model") ?? env("KNOWLEDGE_MODEL") ?? DEFAULT_MODEL;
  const effort = (arg("effort") ?? "low") as Effort;
  const executor = arg("executor") ?? "local";
  const concurrency = Number(arg("concurrency") ?? 24);
  const out = path.resolve(arg("out") ?? defaultKnowledgePath());
  const cache = new DiskCache(knowledgeCacheDir());

  const loaded = loadCatalogIndex();
  if (!loaded) throw new Error("No catalogue index: run `pnpm index:build` first.");
  const products = loaded.index.products;
  const rawFile = path.join(valioDataDir(), PRODUCT_FILE);
  if (!existsSync(rawFile)) throw new Error(`Partner product file not found at ${rawFile}; set VALIO_DATA_DIR.`);
  console.log(`Reading ${products.length} products…`);
  const raw = new Map<string, Record<string, unknown>>();
  for (const r of JSON.parse(readFileSync(rawFile, "utf8")) as Record<string, unknown>[]) if (typeof r.id === "string") raw.set(r.id, r);

  const wanted = arg("categories")?.split(",").map((s) => s.trim());
  const byCat = new Map<string, IndexedProduct[]>();
  for (const p of products) {
    if (wanted && !wanted.includes(p.categoryCode)) continue;
    const list = byCat.get(p.categoryCode) ?? [];
    list.push(p);
    byCat.set(p.categoryCode, list);
  }
  const cats = [...byCat.keys()].sort();
  console.log(`${cats.length} categories, ${[...byCat.values()].reduce((s, l) => s + l.length, 0)} products, model ${model} (effort ${effort}), executor ${executor}`);

  // ---- pass 1: kinds per category ----
  const taxSpecs = new Map<string, LlmSpec>();
  for (const c of cats) {
    const names = [...new Set(byCat.get(c)!.map(nameLine))].sort();
    taxSpecs.set(c, { model, effort, system: TAXONOMY_SYSTEM, user: taxonomyUser(c, names), schema: TAXONOMY_SCHEMA, schemaName: "category_kinds", maxOutputTokens: 4000 });
  }
  if (flag("plan")) {
    const inChars = [...taxSpecs.values()].reduce((s, x) => s + x.system.length + x.user.length, 0);
    const lines = [...byCat.values()].flat().map((p) => modelInput(raw.get(p.id) ?? {}, p).line.length);
    const profileChars = lines.reduce((s, n) => s + n, 0) + Math.ceil(lines.length / BATCH) * (PROFILE_SYSTEM.length + 600);
    console.log(`Plan: ${taxSpecs.size} taxonomy calls (~${Math.round(inChars / 4 / 1000)}k input tokens), ${Math.ceil(lines.length / BATCH)} profile calls (~${Math.round(profileChars / 4 / 1000)}k input tokens, ~${Math.round((lines.length * 60) / 1000)}k output tokens)`);
    return;
  }
  const taxAnswers = await answerAll([...taxSpecs.values()], cache, "kinds", executor, concurrency);
  const kindsByCat = new Map<string, KindDef[]>();
  for (const c of cats) {
    const a = taxAnswers.get(specKey(taxSpecs.get(c)!))?.output as TaxonomyAnswer | undefined;
    const seen = new Set<string>();
    const kinds: KindDef[] = [];
    for (const k of a?.kinds ?? []) {
      const slug = slugify(k.slug);
      if (seen.has(slug) || !isFamily(k.family) || !k.label?.trim()) continue;
      seen.add(slug);
      kinds.push({ key: `${c}.${slug}`, category: c, slug, label: k.label.trim().toLowerCase().slice(0, 60), family: k.family, aliases: (k.aliases ?? []).map((x) => x.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 4) });
    }
    if (kinds.length) kindsByCat.set(c, kinds);
  }
  console.log(`  ${[...kindsByCat.values()].reduce((s, k) => s + k.length, 0)} kinds in ${kindsByCat.size} categories`);

  // ---- pass 2: product profiles, by category in batches ----
  const profiles = new Map<string, Profile>();
  const allAnswers: CachedAnswer[] = [...taxAnswers.values()];
  for (const [round, size] of [
    [1, BATCH],
    [2, RETRY_BATCH],
  ] as const) {
    const specs: { spec: LlmSpec; cat: string }[] = [];
    for (const c of cats) {
      const kinds = kindsByCat.get(c);
      if (!kinds) continue;
      const todo = byCat.get(c)!.filter((p) => !profiles.has(p.id));
      for (const group of chunk(todo, size)) {
        const lines = group.map((p) => modelInput(raw.get(p.id) ?? {}, p).line);
        specs.push({
          cat: c,
          spec: { model, effort, system: PROFILE_SYSTEM, user: profileUser(c, kinds, lines), schema: profileSchema(kinds.map((k) => k.slug)), schemaName: "product_profiles", maxOutputTokens: 200 * group.length + 500 },
        });
      }
    }
    if (!specs.length) break;
    const answers = await answerAll(
      specs.map((s) => s.spec),
      cache,
      `profiles round ${round}`,
      executor,
      concurrency,
    );
    for (const { spec, cat } of specs) {
      const a = answers.get(specKey(spec));
      if (!a) continue;
      allAnswers.push(a);
      const slugs = new Set(kindsByCat.get(cat)!.map((k) => k.slug));
      const ids = new Set(byCat.get(cat)!.map((p) => p.id));
      for (const item of (a.output as ProfileAnswer | undefined)?.products ?? []) {
        if (!ids.has(item.id) || profiles.has(item.id)) continue; // an id the batch did not contain is ignored
        const p = profileFromAnswer(item, cat, slugs);
        if (p) profiles.set(item.id, p);
      }
    }
  }

  const total = [...byCat.values()].reduce((s, l) => s + l.length, 0);
  const spend = spendOf(allAnswers);
  const kinds = [...kindsByCat.values()].flat();
  const data: KnowledgeData = {
    version: 1,
    builtAt: new Date().toISOString(),
    stats: {
      products: total,
      profiled: profiles.size,
      kinds: kinds.length,
      categories: kindsByCat.size,
      model,
      calls: spend.calls,
      costUsd: Math.round(spend.costUsd * 1000) / 1000,
      inputTokens: spend.tokens.input,
      outputTokens: spend.tokens.output,
    },
    kinds,
    profiles: [...profiles.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const json = JSON.stringify(encodeKnowledge(data));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, gzipSync(json, { level: 9 }));
  console.log(`Profiled ${profiles.size}/${total} products, ${kinds.length} kinds -> ${path.relative(process.cwd(), out)}`);
  console.log(`  spend (all answers used, cached or not): $${spend.costUsd.toFixed(3)} over ${spend.calls} calls, ${spend.tokens.input} input / ${spend.tokens.output} output tokens`);
}

main().catch((err) => {
  console.error(`knowledge:build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
