import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Client as PgClient } from "pg";
import { decodeIndex, isIndexFile, type CatalogIndex } from "@/core/catalog/partner";

/**
 * Where the catalogue index lives and how it is loaded. The index is derived from partner data that must not be
 * published, so it sits in a git-ignored folder (`web/.data/valio/`) and is built locally with `pnpm index:build`.
 *
 * A deployed server has no partner files and no index in its image. There, `resolveCatalogIndex()` fetches the
 * index from the project's PostgreSQL (one row, written by `pnpm index:publish`) and caches it on local disk.
 */

const envValue = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

/** `VALIO_INDEX_PATH`, or `.data/valio/catalog-index.json.gz` under the web app. */
export function defaultIndexPath(): string {
  return envValue("VALIO_INDEX_PATH") ?? path.join(process.cwd(), ".data", "valio", "catalog-index.json.gz");
}

/** `VALIO_DATA_DIR`, or `data/valio` at the repository root (one level above web/). */
export function valioDataDir(): string {
  return envValue("VALIO_DATA_DIR") ?? path.resolve(process.cwd(), "..", "data", "valio");
}

/** Where an index fetched from the database is cached: `VALIO_INDEX_CACHE_DIR`, or `.data/valio/cache`. */
export function indexCacheDir(): string {
  return envValue("VALIO_INDEX_CACHE_DIR") ?? path.join(process.cwd(), ".data", "valio", "cache");
}

export function indexExists(file = defaultIndexPath()): boolean {
  return existsSync(file);
}

export type LoadedIndex = { index: CatalogIndex; file: string; loadMs: number };

const cache = new Map<string, LoadedIndex>();

/** Load and check the index. Returns null when there is none; throws when the file exists but is not an index. */
export function loadCatalogIndex(file = defaultIndexPath()): LoadedIndex | null {
  const hit = cache.get(file);
  if (hit) return hit;
  if (!existsSync(file)) return null;
  const t0 = performance.now();
  const bytes = readFileSync(file);
  const json = file.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  const parsed: unknown = JSON.parse(json);
  if (!isIndexFile(parsed)) throw new Error(`${file} is not a catalogue index of the expected version. Rebuild it with \`pnpm index:build\`.`);
  const index = decodeIndex(parsed);
  const loaded = { index, file, loadMs: Math.round(performance.now() - t0) };
  cache.set(file, loaded);
  return loaded;
}

// --- The index in PostgreSQL -------------------------------------------------------------------------------------

/**
 * Its own schema, so the read-only Grafana role (granted SELECT on `public` and `telemetry` only) cannot read
 * partner data. One row: id is always 1.
 */
export const INDEX_TABLE = "partner_data.catalog_index";
export const INDEX_TABLE_DDL = `
create schema if not exists partner_data;
create table if not exists partner_data.catalog_index (
  id            smallint primary key default 1 check (id = 1),
  sha256        text not null,
  built_at      timestamptz not null,
  published_at  timestamptz not null default now(),
  product_count integer not null,
  index_version integer not null,
  byte_size     integer not null,
  bytes         bytea not null
);`;

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** node-postgres reads Aiven's `sslmode=require` as verify-full unless libpq compatibility is on. */
export function pgConnectionString(raw: string): string {
  const url = new URL(raw);
  if (!url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
  return url.toString();
}

export function pgClient(raw: string, timeoutMs = 8_000): PgClient {
  return new PgClient({ connectionString: pgConnectionString(raw), connectionTimeoutMillis: timeoutMs, query_timeout: 4 * timeoutMs, application_name: "dock-index" });
}

/** How the server got its catalogue index (shown by /api/health). */
export type IndexResolution =
  | { from: "file"; file: string }
  | { from: "database"; file: string; sha256: string; builtAt: string; downloaded: boolean; ms: number }
  | { from: "cache"; file: string; reason: string }
  | { from: "none"; reason: string };

const g = globalThis as typeof globalThis & { __dockIndexResolution?: IndexResolution };

export function lastIndexResolution(): IndexResolution | undefined {
  return g.__dockIndexResolution;
}

function log(level: "info" | "warn", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, at: new Date().toISOString(), component: "catalog-index", msg, ...extra });
  if (level === "warn") console.warn(line);
  else console.log(line);
}

const errText = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const url = envValue("DATABASE_URL");
  if (!url) return msg;
  let out = msg.split(url).join("<DATABASE_URL>");
  try {
    const pw = new URL(url).password;
    if (pw) out = out.split(pw).join("<password>").split(decodeURIComponent(pw)).join("<password>");
  } catch {
    /* not a URL */
  }
  return out;
};

const cachedFile = (dir: string, sha: string) => path.join(dir, `catalog-index-${sha.slice(0, 16)}.json.gz`);

function newestCached(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((f) => /^catalog-index-[0-9a-f]{16}\.json\.gz$/.test(f))
    .map((f) => path.join(dir, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/**
 * The index file to load, or undefined for the seed. Order: a local file (`VALIO_INDEX_PATH` / `.data/valio/`),
 * then the row in PostgreSQL (`DATABASE_URL`), cached on disk by content hash, then a cached copy from an earlier
 * start. Never throws: an unreachable database means the seed, and the log says so.
 */
export async function resolveCatalogIndex(opts: { timeoutMs?: number } = {}): Promise<string | undefined> {
  const done = (r: IndexResolution) => {
    g.__dockIndexResolution = r;
    return "file" in r ? r.file : undefined;
  };
  const local = defaultIndexPath();
  if (existsSync(local)) return done({ from: "file", file: local });

  const dir = indexCacheDir();
  const fallback = (reason: string) => {
    const old = newestCached(dir);
    if (old) {
      log("warn", `catalogue index: ${reason}; using the copy cached at an earlier start`, { file: old });
      return done({ from: "cache", file: old, reason });
    }
    log("warn", `catalogue index: ${reason}; running on the 12-product seed catalogue`);
    return done({ from: "none", reason });
  };

  const url = envValue("DATABASE_URL");
  if (!url) return fallback("no local index file and DATABASE_URL is not set");

  // One slow answer from the database at start must not leave the server on the seed catalogue until its next
  // restart (that happened on the public site on 14 Nov, under load from elsewhere). The default path therefore
  // tries several times, giving the database longer each time. A caller that sets its own timeout gets one try.
  const tries = opts.timeoutMs === undefined ? [10_000, 20_000, 30_000, 30_000] : [opts.timeoutMs];
  const pauses = [2_000, 5_000, 10_000];
  let lastError = "";
  for (let i = 0; i < tries.length; i++) {
    const t0 = performance.now();
    const client = pgClient(url, tries[i]);
    client.on("error", () => {}); // a dropped connection after we are done must not crash the process
    try {
      await client.connect();
      const head = await client.query<{ sha256: string; built_at: Date }>(`select sha256, built_at from ${INDEX_TABLE} where id = 1`);
      const row = head.rows[0];
      if (!row) return fallback(`no index published in ${INDEX_TABLE} (run \`pnpm index:publish\`)`);
      const file = cachedFile(dir, row.sha256);
      const meta = { sha256: row.sha256, builtAt: row.built_at.toISOString() };
      if (existsSync(file) && sha256Hex(readFileSync(file)) === row.sha256) {
        log("info", "catalogue index: using the cached copy of the published index", { file, ...meta });
        return done({ from: "database", file, ...meta, downloaded: false, ms: Math.round(performance.now() - t0) });
      }
      const body = await client.query<{ bytes: Buffer }>(`select bytes from ${INDEX_TABLE} where id = 1 and sha256 = $1`, [row.sha256]);
      const bytes = body.rows[0]?.bytes;
      if (!bytes) return fallback("the published index changed while it was being read");
      if (sha256Hex(bytes) !== row.sha256) return fallback("the published index does not match its content hash");
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, file);
      const ms = Math.round(performance.now() - t0);
      log("info", "catalogue index: downloaded from PostgreSQL and cached", { file, bytes: bytes.length, ms, attempt: i + 1, ...meta });
      return done({ from: "database", file, ...meta, downloaded: true, ms });
    } catch (err) {
      lastError = errText(err);
      if (i < tries.length - 1) {
        log("warn", `catalogue index: PostgreSQL did not answer (${lastError}); trying again`, { attempt: i + 1, of: tries.length });
        await new Promise((r) => setTimeout(r, pauses[i] ?? 10_000));
      }
    } finally {
      await client.end().catch(() => {});
    }
  }
  return fallback(`PostgreSQL unreachable or unreadable (${lastError})`);
}
