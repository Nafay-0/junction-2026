/**
 * pnpm aiven:search:compare [--json <file>]
 *
 * The same realistic kitchen queries (Finnish, Swedish, English) against the in-process LexicalSearch and the
 * OpenSearch index (`pnpm aiven:search:index` first): top 5 of each side by side, latency, overlap@5.
 * Product names are partner data: they go to the terminal only. `--json` writes ids and timings to a file
 * of your choice (keep it out of git).
 */
import { writeFileSync } from "node:fs";
import { LexicalSearch, type SearchHit, type SearchQuery } from "@/core/catalog/search";
import { OpenSearchProductSearch } from "@/server/aiven/search/opensearch-search";
import { loadCatalogIndex } from "@/server/valio/index-store";
import { env, loadLocalEnv } from "./lib/env";

const QUERIES: { lang: "fi" | "sv" | "en"; q: SearchQuery }[] = [
  { lang: "fi", q: { text: "laktoositon maito 1,5 % 10 l" } },
  { lang: "fi", q: { text: "kermaa ruoanlaittoon" } },
  { lang: "fi", q: { text: "gluteeniton leipä" } },
  { lang: "fi", q: { text: "kaurajuoma barista", forbiddenAllergens: ["milk"] } },
  { lang: "sv", q: { text: "laktosfri mjölk", category: "milk" } },
  { lang: "sv", q: { text: "vispgrädde" } },
  { lang: "sv", q: { text: "glutenfritt bröd" } },
  { lang: "sv", q: { text: "havredryck" } },
  { lang: "en", q: { text: "lactose-free milk 1.5%", category: "milk" } },
  { lang: "en", q: { text: "cooking cream" } },
  { lang: "en", q: { text: "oat drink barista" } },
  { lang: "en", q: { text: "unsalted butter 500 g" } },
];

const nameOf = (h: SearchHit) => (h.product.names.en ?? h.product.names.fi ?? h.product.id).slice(0, 44);
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  loadLocalEnv();
  const url = env("OPENSEARCH_URL");
  if (!url) throw new Error("OPENSEARCH_URL is not set (web/.env.local).");
  const loaded = loadCatalogIndex();
  if (!loaded) throw new Error("No catalogue index. Run `pnpm index:build` or set VALIO_INDEX_PATH.");
  const byId = new Map(loaded.index.products.map((p) => [p.id, p]));
  const t0 = performance.now();
  const lexical = new LexicalSearch(loaded.index.products);
  const lexicalBuildMs = Math.round(performance.now() - t0);
  const os = new OpenSearchProductSearch({ url, byId: (id) => byId.get(id), alias: env("DOCK_SEARCH_ALIAS"), timeoutMs: 5000 });
  await os.search({ text: "maito" }); // warm the connection

  const results = [];
  for (const { lang, q } of QUERIES) {
    const lexMs: number[] = [];
    const osMs: number[] = [];
    let lex: SearchHit[] = [];
    let ops: SearchHit[] = [];
    for (let i = 0; i < 3; i++) {
      let t = performance.now();
      lex = lexical.search({ ...q, limit: 5 });
      lexMs.push(performance.now() - t);
      t = performance.now();
      ops = await os.search({ ...q, limit: 5 });
      osMs.push(performance.now() - t);
    }
    const lexIds = lex.map((h) => h.product.id);
    const osIds = ops.map((h) => h.product.id);
    const overlap = lexIds.filter((id) => osIds.includes(id)).length;
    const filters = [q.category && `category ${q.category}`, q.forbiddenAllergens?.length && `no ${q.forbiddenAllergens.join(",")}`].filter(Boolean).join("; ");
    console.log(`\n[${lang}] "${q.text}"${filters ? `  (${filters})` : ""}   lexical ${median(lexMs).toFixed(1)} ms | opensearch ${median(osMs).toFixed(0)} ms | overlap@5 ${overlap}/5`);
    for (let i = 0; i < 5; i++) {
      const a = lex[i];
      const b = ops[i];
      console.log(`  ${i + 1}. ${pad(a ? `${a.product.id} ${nameOf(a)}` : "-", 58)} | ${b ? `${b.product.id} ${nameOf(b)}` : "-"}`);
    }
    results.push({ lang, query: q, lexical: lexIds, opensearch: osIds, overlapAt5: overlap, lexicalMs: +median(lexMs).toFixed(2), opensearchMs: Math.round(median(osMs)) });
  }
  const summary = {
    at: new Date().toISOString(),
    products: loaded.index.products.length,
    lexicalBuildMs,
    meanOverlapAt5: +(results.reduce((s, r) => s + r.overlapAt5, 0) / results.length).toFixed(2),
    medianLexicalMs: +median(results.map((r) => r.lexicalMs)).toFixed(2),
    medianOpenSearchMs: median(results.map((r) => r.opensearchMs)),
    results,
  };
  console.log(`\nmean overlap@5 ${summary.meanOverlapAt5}; median latency lexical ${summary.medianLexicalMs} ms, opensearch ${summary.medianOpenSearchMs} ms (index of ${lexicalBuildMs} ms build in-process)`);
  const jsonFlag = process.argv.indexOf("--json");
  if (jsonFlag >= 0 && process.argv[jsonFlag + 1]) writeFileSync(process.argv[jsonFlag + 1], JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`aiven:search:compare failed: ${err instanceof Error ? err.message.replace(/\/\/[^@\s]+@/g, "//***@") : String(err)}`);
  process.exit(1);
});
