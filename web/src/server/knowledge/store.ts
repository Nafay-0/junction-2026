import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { pgClient, sha256Hex } from "@/server/valio/index-store";
import { decodeKnowledge, isKnowledgeFile, type KnowledgeData } from "./types";

/**
 * Where the knowledge map lives. Like the catalogue index it is derived from partner data, so it is never in the
 * repository or the image: a git-ignored file locally (`pnpm knowledge:build`), and one row in PostgreSQL for a
 * deployed server (`pnpm knowledge:publish`), in the `partner_data` schema the read-only Grafana role cannot read.
 */

const envValue = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

/** `KNOWLEDGE_MAP_PATH`, or `.data/valio/knowledge-map.json.gz` under the web app. */
export function defaultKnowledgePath(): string {
  return envValue("KNOWLEDGE_MAP_PATH") ?? path.join(process.cwd(), ".data", "valio", "knowledge-map.json.gz");
}

/** Model answers cached by request hash (build only). */
export function knowledgeCacheDir(): string {
  return envValue("KNOWLEDGE_CACHE_DIR") ?? path.join(process.cwd(), ".data", "valio", "knowledge-cache");
}

export const KNOWLEDGE_TABLE = "partner_data.knowledge_map";
export const KNOWLEDGE_TABLE_DDL = `
create schema if not exists partner_data;
create table if not exists partner_data.knowledge_map (
  id            smallint primary key default 1 check (id = 1),
  sha256        text not null,
  built_at      timestamptz not null,
  published_at  timestamptz not null default now(),
  product_count integer not null,
  version       integer not null,
  byte_size     integer not null,
  bytes         bytea not null
);`;

export function parseKnowledgeBytes(bytes: Buffer): KnowledgeData {
  const parsed: unknown = JSON.parse(gunzipSync(bytes).toString("utf8"));
  if (!isKnowledgeFile(parsed)) throw new Error("not a knowledge map of the expected version; rebuild it with `pnpm knowledge:build`");
  return decodeKnowledge(parsed);
}

export type KnowledgeSource = { from: "file" | "database" | "cache"; file: string } | { from: "none"; reason: string };

/**
 * The map file to load: a local file first, then the row in PostgreSQL (cached on disk by content hash), then a
 * copy cached at an earlier start. Never throws.
 */
export async function resolveKnowledgeFile(): Promise<KnowledgeSource> {
  const local = defaultKnowledgePath();
  if (existsSync(local)) return { from: "file", file: local };
  const dir = path.join(process.cwd(), ".data", "valio", "cache");
  const url = envValue("DATABASE_URL");
  const cachedAny = () => {
    const f = path.join(dir, "knowledge-map-latest.json.gz");
    return existsSync(f) ? f : undefined;
  };
  if (!url) {
    const f = cachedAny();
    return f ? { from: "cache", file: f } : { from: "none", reason: "no local knowledge map and DATABASE_URL is not set" };
  }
  const client = pgClient(url, 8_000);
  client.on("error", () => {});
  try {
    await client.connect();
    const head = await client.query<{ sha256: string }>(`select sha256 from ${KNOWLEDGE_TABLE} where id = 1`);
    const sha = head.rows[0]?.sha256;
    if (!sha) {
      const f = cachedAny();
      return f ? { from: "cache", file: f } : { from: "none", reason: `nothing published in ${KNOWLEDGE_TABLE} (run \`pnpm knowledge:publish\`)` };
    }
    const file = path.join(dir, `knowledge-map-${sha.slice(0, 16)}.json.gz`);
    if (existsSync(file) && sha256Hex(readFileSync(file)) === sha) return { from: "database", file };
    const body = await client.query<{ bytes: Buffer }>(`select bytes from ${KNOWLEDGE_TABLE} where id = 1 and sha256 = $1`, [sha]);
    const bytes = body.rows[0]?.bytes;
    if (!bytes || sha256Hex(bytes) !== sha) return { from: "none", reason: "the published knowledge map does not match its hash" };
    mkdirSync(dir, { recursive: true });
    for (const target of [file, path.join(dir, "knowledge-map-latest.json.gz")]) {
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, target);
    }
    return { from: "database", file };
  } catch (err) {
    const f = cachedAny();
    const reason = `PostgreSQL unreachable (${err instanceof Error ? err.message.split(url).join("<DATABASE_URL>").slice(0, 120) : "error"})`;
    return f ? { from: "cache", file: f } : { from: "none", reason };
  } finally {
    await client.end().catch(() => {});
  }
}

export function loadKnowledgeFile(file: string): KnowledgeData {
  return parseKnowledgeBytes(readFileSync(file));
}
