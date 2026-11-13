import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { decodeIndex, isIndexFile, type CatalogIndex } from "@/core/catalog/partner";

/**
 * Where the catalogue index lives and how it is loaded. The index is derived from partner data that must not be
 * published, so it sits in a git-ignored folder (`web/.data/valio/`) and is built locally with `pnpm index:build`.
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
