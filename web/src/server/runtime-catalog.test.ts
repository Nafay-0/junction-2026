import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCatalogIndex, encodeIndex } from "@/core/catalog/partner";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV } from "@/core/catalog/test-data";
import { signMandate } from "@/core/mandate";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "./dev-fixtures";
import { buildCatalog, getRuntime, resetRuntime } from "./runtime";
import { ValioCatalog } from "./valio/valio-catalog";

const KEYS = ["VALIO_API_KEY", "VALIO_INDEX_PATH", "DOCK_CATALOG", "VALIO_API_BASE"] as const;
let saved: Record<string, string | undefined>;
let dir: string;
let indexFile: string;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  dir = mkdtempSync(path.join(tmpdir(), "dock-index-"));
  indexFile = path.join(dir, "catalog-index.json.gz");
  writeFileSync(indexFile, gzipSync(JSON.stringify(encodeIndex(buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV)))));
  resetRuntime();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
  resetRuntime();
});

describe("catalogue selection", () => {
  it("uses the seed without a key, even when an index exists", () => {
    process.env.VALIO_INDEX_PATH = indexFile;
    expect(buildCatalog().catalogSource).toEqual({ kind: "seed" });
  });

  it("uses the seed with a key but no index", () => {
    process.env.VALIO_API_KEY = "k";
    process.env.VALIO_INDEX_PATH = path.join(dir, "missing.json.gz");
    expect(buildCatalog().catalogSource).toEqual({ kind: "seed" });
  });

  it("uses the partner catalogue with a key and an index, unless DOCK_CATALOG=seed", () => {
    process.env.VALIO_API_KEY = "k";
    process.env.VALIO_INDEX_PATH = indexFile;
    const { catalog, catalogSource } = buildCatalog();
    expect(catalog).toBeInstanceOf(ValioCatalog);
    expect(catalogSource).toMatchObject({ kind: "valio", products: FIXTURE_PRODUCTS.length, indexFile });
    process.env.DOCK_CATALOG = "seed";
    expect(buildCatalog().catalogSource).toEqual({ kind: "seed" });
  });

  it("serves partner products through the HTTP routes when selected", async () => {
    process.env.VALIO_API_KEY = "k";
    process.env.VALIO_INDEX_PATH = indexFile;
    const { dock, catalogSource } = await getRuntime();
    expect(catalogSource.kind).toBe("valio");
    const session = await dock.authenticate(await signMandate(demoMandate(new Date()), await demoOrgKeyPair()), DEMO_ORG.agentId);
    const req = await dock.openRequest(session, { text: "1,000 litres of lactose-free milk" });
    const products = await dock.searchProducts(session, { requestId: req.requestId, text: "laktoositon maito", category: "milk", attributes: ["lactose_free"], limit: 3 });
    expect(products.map((p) => p.source)).toEqual(["valio", "valio", "valio"]);
    expect(dock.stats()).toMatchObject({ searches: 1, liveCalls: 0 });
  });
});
