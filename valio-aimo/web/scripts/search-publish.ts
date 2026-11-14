/**
 * Publish smart search's product vectors to the project's PostgreSQL, so a deployed server (no partner files, no
 * vectors in its image) loads them at startup, next to the catalogue index and the knowledge map.
 *
 *   pnpm search:publish                reads DOCK_SEARCH_VECTORS_PATH (default .data/valio/search-vectors.json.gz)
 *   pnpm search:publish --status       show what is published, change nothing
 *
 * One row in partner_data.search_vectors (about 12 MB): the gzipped vectors, their SHA-256, model, dimensions and
 * count. The schema is not readable by the Grafana role. The vectors are derived from partner data: never commit
 * them. Nothing here prints product content.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { VECTORS_TABLE, VECTORS_TABLE_DDL, defaultVectorsPath, parseVectorsBytes } from "@/server/search/vectors";
import { pgClient, sha256Hex } from "@/server/valio/index-store";
import { env, loadLocalEnv } from "./lib/env";

type Row = { sha256: string; built_at: Date; published_at: Date; product_count: number; model: string; dim: number; byte_size: number };

async function main() {
  loadLocalEnv();
  const url = env("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not set (web/.env.local).");
  const client = pgClient(url, 30_000);
  await client.connect();
  try {
    await client.query(VECTORS_TABLE_DDL);
    const current = async () => (await client.query<Row>(`select sha256, built_at, published_at, product_count, model, dim, byte_size from ${VECTORS_TABLE} where id = 1`)).rows[0];
    const show = (r: Row | undefined) => (r ? `${r.product_count} vectors, ${r.model} at ${r.dim} dimensions, built ${r.built_at.toISOString()}, published ${r.published_at.toISOString()}, ${(r.byte_size / 1024 / 1024).toFixed(1)} MB, sha256 ${r.sha256.slice(0, 16)}…` : "nothing published");
    if (process.argv.includes("--status")) {
      console.log(`${VECTORS_TABLE}: ${show(await current())}`);
      return;
    }
    const file = defaultVectorsPath();
    const bytes = readFileSync(file);
    const v = parseVectorsBytes(bytes); // refuses anything that is not a vectors file of this version
    const sha = sha256Hex(bytes);
    const before = await current();
    if (before?.sha256 === sha) {
      console.log(`Already published: ${show(before)}`);
      return;
    }
    await client.query(
      `insert into ${VECTORS_TABLE} (id, sha256, built_at, published_at, product_count, model, dim, byte_size, bytes)
       values (1, $1, $2, now(), $3, $4, $5, $6, $7)
       on conflict (id) do update set sha256 = excluded.sha256, built_at = excluded.built_at, published_at = now(),
         product_count = excluded.product_count, model = excluded.model, dim = excluded.dim, byte_size = excluded.byte_size, bytes = excluded.bytes`,
      [sha, v.meta.builtAt, v.size, v.meta.model, v.meta.dim, bytes.length, bytes],
    );
    const after = await current();
    if (after?.sha256 !== sha) throw new Error("The row did not read back with the published hash.");
    console.log(`Published ${path.relative(process.cwd(), file)}: ${show(after)}`);
    console.log("A running server picks it up at its next start.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`search:publish failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
