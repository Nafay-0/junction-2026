import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastIndexResolution, resolveCatalogIndex, sha256Hex } from "./index-store";

const KEYS = ["VALIO_INDEX_PATH", "VALIO_INDEX_CACHE_DIR", "DATABASE_URL"] as const;
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  dir = mkdtempSync(path.join(tmpdir(), "dock-index-store-"));
  process.env.VALIO_INDEX_PATH = path.join(dir, "missing.json.gz");
  process.env.VALIO_INDEX_CACHE_DIR = path.join(dir, "cache");
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolveCatalogIndex", () => {
  it("prefers a local index file and does not touch the database", async () => {
    const file = path.join(dir, "local.json.gz");
    writeFileSync(file, "x");
    process.env.VALIO_INDEX_PATH = file;
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:1/db";
    expect(await resolveCatalogIndex()).toBe(file);
    expect(lastIndexResolution()).toEqual({ from: "file", file });
  });

  it("falls back to the seed without a database, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resolveCatalogIndex()).toBeUndefined();
    expect(lastIndexResolution()).toMatchObject({ from: "none" });
    expect(warn.mock.calls[0][0]).toMatch(/seed/);
  });

  it("does not fail startup when PostgreSQL is unreachable, and never logs the password", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.DATABASE_URL = "postgres://dock:s3cret-pw@127.0.0.1:1/defaultdb?sslmode=require";
    expect(await resolveCatalogIndex({ timeoutMs: 1_000 })).toBeUndefined();
    expect(lastIndexResolution()).toMatchObject({ from: "none", reason: expect.stringMatching(/unreachable/) });
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/seed/);
    expect(logged).not.toContain("s3cret-pw");
  });

  it("uses a copy cached at an earlier start when the database is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bytes = Buffer.from("cached index");
    const cacheDir = process.env.VALIO_INDEX_CACHE_DIR!;
    const cached = path.join(cacheDir, `catalog-index-${sha256Hex(bytes).slice(0, 16)}.json.gz`);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, bytes);
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:1/db";
    expect(await resolveCatalogIndex({ timeoutMs: 1_000 })).toBe(cached);
    expect(lastIndexResolution()).toMatchObject({ from: "cache", file: cached });
  });
});
