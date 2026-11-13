/**
 * Publish the prebuilt catalogue index to the project's PostgreSQL, so a deployed server (which has no partner
 * files and no index in its image) can load the real catalogue at startup.
 *
 *   pnpm index:publish                 reads VALIO_INDEX_PATH (default .data/valio/catalog-index.json.gz)
 *   pnpm index:publish --file <path>   publish another index file
 *   pnpm index:publish --status        show what is published, change nothing
 *
 * Needs DATABASE_URL (web/.env.local). Writes one row in partner_data.catalog_index (see index-store.ts): the
 * gzipped index, its SHA-256, build time and product count. The row is partner data: the schema is not readable
 * by the Grafana role, and nothing here prints product content.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { INDEX_VERSION, isIndexFile } from "@/core/catalog/partner";
import { INDEX_TABLE, INDEX_TABLE_DDL, defaultIndexPath, pgClient, sha256Hex } from "@/server/valio/index-store";
import { env, loadLocalEnv } from "./lib/env";

type Row = { sha256: string; built_at: Date; published_at: Date; product_count: number; index_version: number; byte_size: number };

async function main() {
  loadLocalEnv();
  const url = env("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not set (web/.env.local).");
  const client = pgClient(url, 15_000);
  await client.connect();
  try {
    await client.query(INDEX_TABLE_DDL);
    const current = async () =>
      (await client.query<Row>(`select sha256, built_at, published_at, product_count, index_version, byte_size from ${INDEX_TABLE} where id = 1`)).rows[0];
    const show = (r: Row | undefined) =>
      r
        ? `${r.product_count} products, index v${r.index_version}, built ${r.built_at.toISOString()}, published ${r.published_at.toISOString()}, ${(r.byte_size / 1024 / 1024).toFixed(2)} MB, sha256 ${r.sha256.slice(0, 16)}…`
        : "nothing published";

    if (process.argv.includes("--status")) {
      console.log(`${INDEX_TABLE}: ${show(await current())}`);
      return;
    }

    const fileFlag = process.argv.indexOf("--file");
    const file = fileFlag >= 0 ? path.resolve(process.argv[fileFlag + 1]) : defaultIndexPath();
    const bytes = readFileSync(file);
    const parsed: unknown = JSON.parse((file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
    if (!isIndexFile(parsed)) throw new Error(`${file} is not a catalogue index of version ${INDEX_VERSION}. Rebuild it with \`pnpm index:build\`.`);
    if (!file.endsWith(".gz")) throw new Error("Publish the gzipped index (.json.gz).");
    const sha = sha256Hex(bytes);
    const before = await current();
    if (before?.sha256 === sha) {
      console.log(`Already published: ${show(before)}`);
      return;
    }
    await client.query(
      `insert into ${INDEX_TABLE} (id, sha256, built_at, published_at, product_count, index_version, byte_size, bytes)
       values (1, $1, $2, now(), $3, $4, $5, $6)
       on conflict (id) do update set sha256 = excluded.sha256, built_at = excluded.built_at, published_at = now(),
         product_count = excluded.product_count, index_version = excluded.index_version, byte_size = excluded.byte_size, bytes = excluded.bytes`,
      [sha, parsed.builtAt, parsed.rows.length, INDEX_VERSION, bytes.length, bytes],
    );
    const after = await current();
    if (after?.sha256 !== sha) throw new Error("The row did not read back with the published hash.");
    console.log(`Published ${path.relative(process.cwd(), file)}: ${show(after)}`);
    if (before) console.log(`  replaced: ${show(before)}`);
    console.log("A running server picks it up at its next start (redeploy, or restart the Runtime app).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`index:publish failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
