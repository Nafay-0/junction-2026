/**
 * Publish the knowledge map to the project's PostgreSQL, so a deployed server (no partner files, no map in its
 * image) can load it at startup, next to the catalogue index (`pnpm index:publish`).
 *
 *   pnpm knowledge:publish                 reads KNOWLEDGE_MAP_PATH (default .data/valio/knowledge-map.json.gz)
 *   pnpm knowledge:publish --status        show what is published, change nothing
 *
 * One row in partner_data.knowledge_map: the gzipped map, its SHA-256, build time and product count. The schema
 * is not readable by the Grafana role; nothing here prints product content.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { KNOWLEDGE_TABLE, KNOWLEDGE_TABLE_DDL, defaultKnowledgePath, parseKnowledgeBytes } from "@/server/knowledge/store";
import { KNOWLEDGE_VERSION } from "@/server/knowledge/types";
import { pgClient, sha256Hex } from "@/server/valio/index-store";
import { env, loadLocalEnv } from "./lib/env";

type Row = { sha256: string; built_at: Date; published_at: Date; product_count: number; version: number; byte_size: number };

async function main() {
  loadLocalEnv();
  const url = env("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not set (web/.env.local).");
  const client = pgClient(url, 15_000);
  await client.connect();
  try {
    await client.query(KNOWLEDGE_TABLE_DDL);
    const current = async () => (await client.query<Row>(`select sha256, built_at, published_at, product_count, version, byte_size from ${KNOWLEDGE_TABLE} where id = 1`)).rows[0];
    const show = (r: Row | undefined) =>
      r ? `${r.product_count} profiles, v${r.version}, built ${r.built_at.toISOString()}, published ${r.published_at.toISOString()}, ${(r.byte_size / 1024).toFixed(0)} KB, sha256 ${r.sha256.slice(0, 16)}…` : "nothing published";
    if (process.argv.includes("--status")) {
      console.log(`${KNOWLEDGE_TABLE}: ${show(await current())}`);
      return;
    }
    const file = defaultKnowledgePath();
    const bytes = readFileSync(file);
    const data = parseKnowledgeBytes(bytes); // refuses anything that is not a map of this version
    const sha = sha256Hex(bytes);
    const before = await current();
    if (before?.sha256 === sha) {
      console.log(`Already published: ${show(before)}`);
      return;
    }
    await client.query(
      `insert into ${KNOWLEDGE_TABLE} (id, sha256, built_at, published_at, product_count, version, byte_size, bytes)
       values (1, $1, $2, now(), $3, $4, $5, $6)
       on conflict (id) do update set sha256 = excluded.sha256, built_at = excluded.built_at, published_at = now(),
         product_count = excluded.product_count, version = excluded.version, byte_size = excluded.byte_size, bytes = excluded.bytes`,
      [sha, data.builtAt, data.profiles.length, KNOWLEDGE_VERSION, bytes.length, bytes],
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
  console.error(`knowledge:publish failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
