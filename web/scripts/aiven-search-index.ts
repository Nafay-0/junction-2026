/**
 * pnpm aiven:search:index
 *
 * (Re)build the OpenSearch product index on dock-search from the local catalogue index (`pnpm index:build`,
 * or VALIO_INDEX_PATH). Fills the next version `dock-products-v<N>`, checks the count, swaps the alias
 * `dock-products` to it in one call, then deletes older versions. Safe to rerun; searches keep working
 * throughout, because they read the alias.
 *
 * Needs OPENSEARCH_URL (web/.env.local). Prints no secrets and no product data.
 */
import { Client } from "@opensearch-project/opensearch";
import { INDEX_PREFIX, SEARCH_ALIAS, indexMappings, indexSettings, toDoc } from "@/server/aiven/search/mapping";
import { loadCatalogIndex } from "@/server/valio/index-store";
import { env, loadLocalEnv } from "./lib/env";

// Batches sized for the free plan (4 GB node): about 1,000 small documents, well under 1 MB per request.
const BATCH = 1000;

async function main() {
  loadLocalEnv();
  const url = env("OPENSEARCH_URL");
  if (!url) throw new Error("OPENSEARCH_URL is not set (web/.env.local).");
  const loaded = loadCatalogIndex();
  if (!loaded) throw new Error("No catalogue index. Run `pnpm index:build` or set VALIO_INDEX_PATH.");
  const products = loaded.index.products;
  const alias = env("DOCK_SEARCH_ALIAS") ?? SEARCH_ALIAS;
  const prefix = alias === SEARCH_ALIAS ? INDEX_PREFIX : `${alias}-v`;
  const client = new Client({ node: url, requestTimeout: 60_000 });
  const t0 = performance.now();

  const existing = ((await client.cat.indices({ index: `${prefix}*`, format: "json" }).catch(() => ({ body: [] }))).body as Array<{ index: string }>).map((i) => i.index);
  const aliased = new Set<string>();
  if ((await client.indices.existsAlias({ name: alias })).body) {
    for (const name of Object.keys((await client.indices.getAlias({ name: alias })).body)) aliased.add(name);
  }
  const versions = existing.map((n) => Number(n.slice(prefix.length))).filter(Number.isFinite);
  const next = `${prefix}${(versions.length ? Math.max(...versions) : 0) + 1}`;
  // Leftovers of an interrupted build (not behind the alias) go first.
  for (const name of existing.filter((n) => !aliased.has(n))) await client.indices.delete({ index: name });

  console.log(`Building ${next} from ${products.length} products (${loaded.file.split("/").pop()}, loaded in ${loaded.loadMs} ms)`);
  await client.indices.create({ index: next, body: { settings: indexSettings, mappings: indexMappings } as never });
  // No refresh while loading: faster, and nobody reads the new index until the alias moves.
  await client.indices.putSettings({ index: next, body: { index: { refresh_interval: "-1" } } });

  let failed = 0;
  for (let i = 0; i < products.length; i += BATCH) {
    const body = products.slice(i, i + BATCH).flatMap((p) => [{ index: { _index: next, _id: p.id } }, toDoc(p)]);
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
  await client.indices.putSettings({ index: next, body: { index: { refresh_interval: indexSettings.refresh_interval } } });
  await client.indices.refresh({ index: next });
  const count = ((await client.count({ index: next })).body as { count: number }).count;
  if (count !== products.length || failed) {
    throw new Error(`${next} holds ${count} of ${products.length} products (${failed} failed); the alias still points to the old version.`);
  }

  const actions: unknown[] = [...[...aliased].map((index) => ({ remove: { index, alias } })), { add: { index: next, alias } }];
  await client.indices.updateAliases({ body: { actions } as never });
  for (const old of aliased) await client.indices.delete({ index: old });

  const stats = (await client.cat.indices({ index: next, format: "json", bytes: "kb" })).body as Array<{ "store.size"?: string; "docs.count"?: string; health?: string }>;
  console.log(
    `Alias ${alias} -> ${next}: ${count} products, ${stats[0]?.["store.size"] ?? "?"} kB, health ${stats[0]?.health ?? "?"}, in ${Math.round(performance.now() - t0)} ms` +
      (aliased.size ? `; removed ${[...aliased].join(", ")}` : ""),
  );
  await client.close();
}

main().catch((err) => {
  const status = (err as { meta?: { statusCode?: number; body?: { error?: { reason?: string } } } })?.meta;
  console.error(`aiven:search:index failed: ${err instanceof Error ? err.message.replace(/\/\/[^@\s]+@/g, "//***@") : String(err)}${status?.statusCode ? ` (HTTP ${status.statusCode}: ${status.body?.error?.reason ?? ""})` : ""}`);
  process.exit(1);
});
