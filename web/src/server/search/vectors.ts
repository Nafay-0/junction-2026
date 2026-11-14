import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { pgClient, sha256Hex } from "@/server/valio/index-store";

/**
 * Semantic vectors for every product, built once (`pnpm search:vectors`) from the product's names, category and
 * knowledge-map facts, and searched in process. Stored compactly: one int8 vector per product with its own scale,
 * gzipped. Derived from partner data, so never committed: a git-ignored file locally, one row in PostgreSQL
 * (`partner_data.search_vectors`, `pnpm search:publish`) for a deployed server, cached on its disk by hash.
 */

export const VECTORS_FORMAT = "dock-search-vectors";
export const VECTORS_VERSION = 1;

export type VectorsMeta = {
  format: typeof VECTORS_FORMAT;
  version: typeof VECTORS_VERSION;
  model: string;
  dim: number;
  builtAt: string;
  /** What the document text was made of (for the record; the build script owns the recipe). */
  recipe: string;
  count: number;
  tokens: number;
  costUsd: number;
};

export class ProductVectors {
  readonly meta: VectorsMeta;
  readonly ids: string[];
  private readonly data: Int8Array;
  private readonly scale: Float32Array;
  private readonly row = new Map<string, number>();

  constructor(meta: VectorsMeta, ids: string[], data: Int8Array, scale: Float32Array) {
    if (data.length !== ids.length * meta.dim || scale.length !== ids.length) throw new Error("vectors file is inconsistent");
    this.meta = meta;
    this.ids = ids;
    this.data = data;
    this.scale = scale;
    ids.forEach((id, i) => this.row.set(id, i));
  }

  get size(): number {
    return this.ids.length;
  }

  has(id: string): boolean {
    return this.row.has(id);
  }

  /**
   * The `k` products closest to a unit query vector (cosine), optionally only among `allow`. About 15 ms for the
   * whole assortment at 768 dimensions.
   */
  nearest(query: Float32Array, k: number, allow?: (id: string) => boolean): { id: string; sim: number }[] {
    const dim = this.meta.dim;
    if (query.length !== dim) throw new Error(`query has ${query.length} dimensions, vectors ${dim}`);
    const n = this.ids.length;
    // A bounded min-heap would be faster for tiny k; a sorted top list is simpler and fast enough for k <= 300.
    const top: { i: number; s: number }[] = [];
    let floor = -Infinity;
    for (let i = 0; i < n; i++) {
      if (allow && !allow(this.ids[i])) continue;
      let s = 0;
      const off = i * dim;
      for (let j = 0; j < dim; j++) s += query[j] * this.data[off + j];
      s /= this.scale[i];
      if (top.length < k) {
        top.push({ i, s });
        if (top.length === k) {
          top.sort((a, b) => b.s - a.s);
          floor = top[k - 1].s;
        }
      } else if (s > floor) {
        let lo = 0;
        let hi = k - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (top[mid].s >= s) lo = mid + 1;
          else hi = mid;
        }
        top.splice(lo, 0, { i, s });
        top.pop();
        floor = top[k - 1].s;
      }
    }
    if (top.length < k) top.sort((a, b) => b.s - a.s);
    return top.map((t) => ({ id: this.ids[t.i], sim: Math.round(t.s * 1000) / 1000 }));
  }
}

/** Quantise unit float vectors to int8, one scale per vector (value = int8 / scale). */
export function quantise(vectors: Float32Array[], dim: number): { data: Int8Array; scale: Float32Array } {
  const data = new Int8Array(vectors.length * dim);
  const scale = new Float32Array(vectors.length);
  vectors.forEach((v, i) => {
    let norm = 0;
    for (let j = 0; j < dim; j++) norm += v[j] * v[j];
    norm = Math.sqrt(norm) || 1;
    let max = 0;
    for (let j = 0; j < dim; j++) max = Math.max(max, Math.abs(v[j] / norm));
    const s = max > 0 ? 127 / max : 1;
    for (let j = 0; j < dim; j++) data[i * dim + j] = Math.round((v[j] / norm) * s);
    scale[i] = s;
  });
  return { data, scale };
}

type FileShape = { meta: VectorsMeta; ids: string[]; data: string; scale: string };

export function encodeVectors(meta: VectorsMeta, ids: string[], data: Int8Array, scale: Float32Array): Buffer {
  const body: FileShape = { meta, ids, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64"), scale: Buffer.from(scale.buffer, scale.byteOffset, scale.byteLength).toString("base64") };
  return gzipSync(Buffer.from(JSON.stringify(body)), { level: 9 });
}

export function parseVectorsBytes(bytes: Buffer): ProductVectors {
  const f = JSON.parse(gunzipSync(bytes).toString("utf8")) as Partial<FileShape>;
  if (!f.meta || f.meta.format !== VECTORS_FORMAT || f.meta.version !== VECTORS_VERSION || !Array.isArray(f.ids) || typeof f.data !== "string" || typeof f.scale !== "string") {
    throw new Error("not a search vectors file of the expected version; rebuild it with `pnpm search:vectors`");
  }
  const d = Buffer.from(f.data, "base64");
  const s = Buffer.from(f.scale, "base64");
  const data = new Int8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  const scale = new Float32Array(s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength));
  return new ProductVectors(f.meta, f.ids.map(String), data, scale);
}

// ---------- where the file lives ----------

const envValue = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

/** `DOCK_SEARCH_VECTORS_PATH`, or `.data/valio/search-vectors.json.gz` under the web app. */
export function defaultVectorsPath(): string {
  return envValue("DOCK_SEARCH_VECTORS_PATH") ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "valio", "search-vectors.json.gz");
}

export const VECTORS_TABLE = "partner_data.search_vectors";
export const VECTORS_TABLE_DDL = `
create schema if not exists partner_data;
create table if not exists partner_data.search_vectors (
  id            smallint primary key default 1 check (id = 1),
  sha256        text not null,
  built_at      timestamptz not null,
  published_at  timestamptz not null default now(),
  product_count integer not null,
  model         text not null,
  dim           integer not null,
  byte_size     integer not null,
  bytes         bytea not null
);`;

export type VectorsSource = { from: "file" | "database" | "cache"; file: string } | { from: "none"; reason: string };

/** The vectors file to load: a local file, then the row in PostgreSQL (cached on disk by hash), then an earlier cached copy. Never throws. */
export async function resolveVectorsFile(): Promise<VectorsSource> {
  const local = defaultVectorsPath();
  if (existsSync(local)) return { from: "file", file: local };
  const dir = path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "valio", "cache");
  const latest = path.join(dir, "search-vectors-latest.json.gz");
  const cached = () => (existsSync(latest) ? latest : undefined);
  const url = envValue("DATABASE_URL");
  if (!url) {
    const f = cached();
    return f ? { from: "cache", file: f } : { from: "none", reason: "no local search vectors and DATABASE_URL is not set (pnpm search:vectors)" };
  }
  const client = pgClient(url, 8_000);
  client.on("error", () => {});
  try {
    await client.connect();
    const head = await client.query<{ sha256: string }>(`select sha256 from ${VECTORS_TABLE} where id = 1`).catch(() => ({ rows: [] as { sha256: string }[] }));
    const sha = head.rows[0]?.sha256;
    if (!sha) {
      const f = cached();
      return f ? { from: "cache", file: f } : { from: "none", reason: `nothing published in ${VECTORS_TABLE} (pnpm search:publish)` };
    }
    const file = path.join(dir, `search-vectors-${sha.slice(0, 16)}.json.gz`);
    if (existsSync(file) && sha256Hex(readFileSync(file)) === sha) return { from: "database", file };
    const body = await client.query<{ bytes: Buffer }>(`select bytes from ${VECTORS_TABLE} where id = 1 and sha256 = $1`, [sha]);
    const bytes = body.rows[0]?.bytes;
    if (!bytes || sha256Hex(bytes) !== sha) return { from: "none", reason: "the published search vectors do not match their hash" };
    mkdirSync(dir, { recursive: true });
    for (const target of [file, latest]) {
      const tmp = `${target}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, target);
    }
    return { from: "database", file };
  } catch (err) {
    const f = cached();
    const reason = `PostgreSQL unreachable (${err instanceof Error ? err.message.split(url).join("<DATABASE_URL>").slice(0, 120) : "error"})`;
    return f ? { from: "cache", file: f } : { from: "none", reason };
  } finally {
    await client.end().catch(() => {});
  }
}

export function loadVectorsFile(file: string): ProductVectors {
  return parseVectorsBytes(readFileSync(file));
}
