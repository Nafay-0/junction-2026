/**
 * pnpm search:publish:opensearch
 *
 * Put smart search's recall index on OpenSearch: every product's names (the catalogue keyword index's fields), its
 * knowledge-map kind and family, and its semantic vector (768 dimensions, HNSW), in a new versioned index, then the
 * alias `dock-recall` switched to it once the count matches. Smart search reads the alias
 * (DOCK_SEARCH_RECALL_BACKEND, server/search/recall-router.ts).
 *
 *   pnpm search:publish:opensearch                    build dock-recall-v<N+1>, check the count, move the alias
 *   pnpm search:publish:opensearch --status           what the alias points to, the versions, their counts
 *   pnpm search:publish:opensearch --rollback         move the alias back to the previous version (kept for this)
 *   pnpm search:publish:opensearch --index <name>     fill exactly this index (a development copy), no alias touched
 *   pnpm search:publish:opensearch --drop <name>      delete one index of this script's own (never one behind an alias)
 *   pnpm search:publish:opensearch --prune            delete versions older than the previous one
 *
 * Never writes to or deletes the catalogue's keyword index (dock-products*) or whatever the alias points to.
 * Needs OPENSEARCH_URL, the catalogue index (pnpm index:build), the knowledge map and the vectors file
 * (DOCK_SEARCH_VECTORS_PATH or what the server would load). Prints no secrets and no product data.
 */
import { Client } from "@opensearch-project/opensearch";
import { RECALL_ALIAS, RECALL_INDEX_PREFIX, recallIndexMappings, recallIndexSettings, toRecallDoc } from "@/server/aiven/search/opensearch-recall";
import { KnowledgeMap } from "@/server/knowledge/map";
import { loadKnowledgeFile, resolveKnowledgeFile } from "@/server/knowledge/store";
import { loadVectorsFile, resolveVectorsFile } from "@/server/search/vectors";
import { loadCatalogIndex } from "@/server/valio/index-store";
import { env, loadLocalEnv } from "./lib/env";

// About 300 documents with 768 floats each: about 2.5 MB per request, gentle on a small node.
const BATCH = 300;
const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (n: string) => argv.includes(`--${n}`);

const ownName = (name: string) => name.startsWith(RECALL_ALIAS) && !name.startsWith("dock-products");

async function versions(client: Client): Promise<{ all: { index: string; v: number; docs: number }[]; aliased: string[] }> {
  const rows = ((await client.cat.indices({ index: `${RECALL_INDEX_PREFIX}*`, format: "json" }).catch(() => ({ body: [] }))).body as Array<{ index: string; "docs.count"?: string }>) ?? [];
  const all = rows
    .map((r) => ({ index: r.index, v: Number(r.index.slice(RECALL_INDEX_PREFIX.length)), docs: Number(r["docs.count"] ?? 0) }))
    .filter((r) => Number.isFinite(r.v))
    .sort((a, b) => a.v - b.v);
  const aliased = (await client.indices.existsAlias({ name: RECALL_ALIAS })).body ? Object.keys((await client.indices.getAlias({ name: RECALL_ALIAS })).body) : [];
  return { all, aliased };
}

async function fill(client: Client, index: string): Promise<number> {
  const loaded = loadCatalogIndex();
  if (!loaded) throw new Error("No catalogue index. Run `pnpm index:build` or set VALIO_INDEX_PATH.");
  const products = loaded.index.products;
  const vsrc = await resolveVectorsFile();
  if (vsrc.from === "none") throw new Error(`No search vectors: ${vsrc.reason}`);
  const vectors = loadVectorsFile(vsrc.file);
  const ksrc = await resolveKnowledgeFile();
  const map = ksrc.from === "none" ? null : new KnowledgeMap(products, loadKnowledgeFile(ksrc.file));
  if (vectors.meta.dim !== recallIndexMappings.properties.vec.dimension) throw new Error(`the vectors have ${vectors.meta.dim} dimensions, the index ${recallIndexMappings.properties.vec.dimension}`);
  console.log(`Filling ${index}: ${products.length} products, ${vectors.size} vectors (${vectors.meta.model}, ${vectors.meta.dim} d, from ${vsrc.from}), knowledge map ${map ? "on" : "missing"}`);
  await client.indices.create({ index, body: { settings: recallIndexSettings, mappings: recallIndexMappings } as never });
  await client.indices.putSettings({ index, body: { index: { refresh_interval: "-1" } } });
  let failed = 0;
  let withVector = 0;
  for (let i = 0; i < products.length; i += BATCH) {
    const body = products.slice(i, i + BATCH).flatMap((p) => {
      const v = vectors.vectorOf(p.id);
      if (v) withVector++;
      const prof = map?.profile(p.id);
      return [{ index: { _index: index, _id: p.id } }, toRecallDoc(p, v, prof ? { kind: prof.kind, family: prof.family } : undefined)];
    });
    const res = await client.bulk({ body });
    if (res.body.errors) {
      const items = res.body.items as Array<Record<string, { error?: { type?: string; reason?: string } }>>;
      const errs = items.map((it) => Object.values(it)[0]?.error).filter(Boolean);
      failed += errs.length;
      console.error(`  batch ${i / BATCH + 1}: ${errs.length} failed, first: ${errs[0]?.type}: ${errs[0]?.reason?.slice(0, 160)}`);
    }
    process.stdout.write(`\r  indexed ${Math.min(i + BATCH, products.length)} / ${products.length}`);
  }
  process.stdout.write("\n");
  await client.indices.putSettings({ index, body: { index: { refresh_interval: recallIndexSettings.refresh_interval } } });
  await client.indices.refresh({ index });
  const count = ((await client.count({ index })).body as { count: number }).count;
  if (count !== products.length || failed) throw new Error(`${index} holds ${count} of ${products.length} products (${failed} failed); no alias was moved.`);
  console.log(`  ${count} products, ${withVector} with a vector`);
  return count;
}

async function main() {
  loadLocalEnv();
  const url = env("OPENSEARCH_URL") ?? env("OPENSEARCH_URI");
  if (!url) throw new Error("OPENSEARCH_URL is not set (web/.env.local).");
  const client = new Client({ node: url, requestTimeout: 120_000 });
  const t0 = performance.now();
  try {
    const { all, aliased } = await versions(client);
    if (flag("status")) {
      console.log(`${RECALL_ALIAS} -> ${aliased.join(", ") || "(no alias)"}`);
      for (const r of all) console.log(`  ${r.index}: ${r.docs} documents${aliased.includes(r.index) ? " (live)" : ""}`);
      return;
    }
    const drop = arg("drop");
    if (drop) {
      if (!ownName(drop)) throw new Error(`${drop} is not an index this script made.`);
      const behind = Object.keys(((await client.indices.getAlias({ index: drop }).catch(() => ({ body: {} }))).body as Record<string, { aliases?: Record<string, unknown> }>)[drop]?.aliases ?? {});
      if (behind.length) throw new Error(`${drop} is behind the alias ${behind.join(", ")}; move the alias first.`);
      await client.indices.delete({ index: drop });
      console.log(`Deleted ${drop}.`);
      return;
    }
    if (flag("rollback")) {
      const live = all.find((r) => aliased.includes(r.index));
      const prev = live ? [...all].reverse().find((r) => r.v < live.v) : undefined;
      if (!live || !prev) throw new Error(`Nothing to roll back to (${RECALL_ALIAS} -> ${aliased.join(", ") || "nothing"}).`);
      await client.indices.updateAliases({ body: { actions: [{ remove: { index: live.index, alias: RECALL_ALIAS } }, { add: { index: prev.index, alias: RECALL_ALIAS } }] } as never });
      console.log(`${RECALL_ALIAS} -> ${prev.index} (was ${live.index}, kept).`);
      return;
    }
    if (flag("prune")) {
      const live = all.find((r) => aliased.includes(r.index));
      const prev = live ? [...all].reverse().find((r) => r.v < live.v) : undefined;
      for (const r of all) if (!aliased.includes(r.index) && (!prev || r.v < prev.v) && (!live || r.v < live.v)) {
        await client.indices.delete({ index: r.index });
        console.log(`Deleted ${r.index}.`);
      }
      return;
    }
    const devIndex = arg("index");
    if (devIndex) {
      if (!ownName(devIndex) || aliased.includes(devIndex)) throw new Error(`--index takes a new name starting with ${RECALL_ALIAS} that is not behind the alias.`);
      if ((await client.indices.exists({ index: devIndex })).body) throw new Error(`${devIndex} exists; --drop it first.`);
      await fill(client, devIndex);
      console.log(`Filled ${devIndex} in ${Math.round(performance.now() - t0)} ms. No alias touched. Point DOCK_SEARCH_RECALL_INDEX=${devIndex} at it.`);
      return;
    }
    const next = `${RECALL_INDEX_PREFIX}${(all.length ? all.at(-1)!.v : 0) + 1}`;
    if ((await client.indices.exists({ index: next })).body) throw new Error(`${next} exists already; --drop it or --prune.`);
    await fill(client, next);
    await client.indices.updateAliases({ body: { actions: [...aliased.map((index) => ({ remove: { index, alias: RECALL_ALIAS } })), { add: { index: next, alias: RECALL_ALIAS } }] } as never });
    console.log(`${RECALL_ALIAS} -> ${next} in ${Math.round(performance.now() - t0)} ms${aliased.length ? ` (was ${aliased.join(", ")}, kept for --rollback)` : ""}.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  const meta = (err as { meta?: { statusCode?: number; body?: { error?: { reason?: string } } } })?.meta;
  console.error(`search:publish:opensearch failed: ${err instanceof Error ? err.message.replace(/\/\/[^@\s]+@/g, "//***@") : String(err)}${meta?.statusCode ? ` (HTTP ${meta.statusCode}: ${meta.body?.error?.reason ?? ""})` : ""}`);
  process.exit(1);
});
