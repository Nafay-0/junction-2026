/**
 * Build the semantic vectors smart search uses: one embedding per product, from its names, category and the
 * knowledge map's facts (server/search/docs.ts), stored compactly beside the index.
 *
 *   pnpm search:vectors                 build .data/valio/search-vectors.json.gz (or DOCK_SEARCH_VECTORS_PATH)
 *   pnpm search:vectors --dim 768       dimensions (default 768; gemini-embedding-2 supports 128..3072)
 *
 * About 1 M input tokens for the whole assortment (about $0.20 at $0.20 per million), 176 requests of 100 texts.
 * Raw answers are cached by text hash under .data/search-build/, so a rebuild after a knowledge-map change only
 * embeds what changed. Prints counts only; the file is partner-derived and git-ignored.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { KnowledgeMap } from "@/server/knowledge/map";
import { loadKnowledgeFile, resolveKnowledgeFile } from "@/server/knowledge/store";
import { EMBEDDING_RECIPE, embeddingText } from "@/server/search/docs";
import { EMBED_MODEL, EMBED_USD_PER_M, embedTexts } from "@/server/search/gemini";
import { VECTORS_FORMAT, VECTORS_VERSION, defaultVectorsPath, encodeVectors, quantise } from "@/server/search/vectors";
import { loadCatalogIndex } from "@/server/valio/index-store";
import { loadLocalEnv } from "./lib/env";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadLocalEnv();
  const dim = Number(arg("dim") ?? 768);
  const loaded = loadCatalogIndex();
  if (!loaded) throw new Error("No catalogue index (pnpm index:build).");
  const src = await resolveKnowledgeFile();
  const map = src.from === "none" ? null : new KnowledgeMap(loaded.index.products, loadKnowledgeFile(src.file));
  if (!map) console.warn(`No knowledge map (${(src as { reason: string }).reason}): embedding names and shelves only.`);
  const products = loaded.index.products;
  const texts = products.map((p) => embeddingText(p, map));
  const cacheDir = path.join(process.cwd(), ".data", "search-build", `embed-${dim}`);
  mkdirSync(cacheDir, { recursive: true });
  const hash = (t: string) => createHash("sha256").update(`${EMBED_MODEL}|${dim}|${t}`).digest("hex").slice(0, 24);
  const vectors: (Float32Array | undefined)[] = texts.map((t) => {
    const f = path.join(cacheDir, `${hash(t)}.f32`);
    if (!existsSync(f)) return undefined;
    const b = readFileSync(f);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  });
  const todo = vectors.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  console.log(`${products.length} products, ${products.length - todo.length} cached, ${todo.length} to embed at ${dim} dimensions`);
  let tokens = 0;
  let done = 0;
  const batches: number[][] = [];
  for (let i = 0; i < todo.length; i += 100) batches.push(todo.slice(i, i + 100));
  const worker = async () => {
    for (let b = batches.shift(); b; b = batches.shift()) {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await embedTexts(b.map((i) => texts[i]), dim, 60_000);
          tokens += r.tokens;
          r.vectors.forEach((v, j) => {
            const i = b[j];
            vectors[i] = v;
            writeFileSync(path.join(cacheDir, `${hash(texts[i])}.f32`), Buffer.from(v.buffer));
          });
          done += b.length;
          if (done % 2000 < 100) console.log(`  ${done}/${todo.length}`);
          break;
        } catch (err) {
          if (attempt >= 4) throw err;
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const ids = products.map((p) => p.id);
  const { data, scale } = quantise(vectors as Float32Array[], dim);
  const meta = { format: VECTORS_FORMAT, version: VECTORS_VERSION, model: EMBED_MODEL, dim, builtAt: new Date().toISOString(), recipe: EMBEDDING_RECIPE, count: ids.length, tokens, costUsd: Math.round(((tokens * EMBED_USD_PER_M) / 1e6) * 10_000) / 10_000 } as const;
  const bytes = encodeVectors(meta, ids, data, scale);
  const out = defaultVectorsPath();
  mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, out);
  console.log(`Wrote ${path.relative(process.cwd(), out)}: ${ids.length} vectors, ${(bytes.length / 1024 / 1024).toFixed(1)} MB, ${tokens} tokens embedded now ($${meta.costUsd}).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
