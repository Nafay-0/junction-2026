import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@opensearch-project/opensearch";
import { buildCatalogIndex } from "@/core/catalog/partner";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV } from "@/core/catalog/test-data";
import { indexMappings, indexSettings, toDoc } from "./mapping";
import { OpenSearchProductSearch } from "./opensearch-search";

/**
 * Against the real dock-search service, on a throwaway index of the fixture products (deleted afterwards).
 * Runs only with DOCK_AIVEN_TESTS=1 and OPENSEARCH_URL set (web/.env.local is read only then); skipped otherwise.
 */
const enabled = process.env.DOCK_AIVEN_TESTS === "1";
if (enabled) {
  const envFile = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
const url = enabled ? process.env.OPENSEARCH_URL?.trim() : undefined;

describe.skipIf(!url)("OpenSearchProductSearch on dock-search", () => {
  const index = buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV);
  const byId = new Map(index.products.map((p) => [p.id, p]));
  const name = `dock-test-${randomUUID().slice(0, 8)}`;
  const client = new Client({ node: url ?? "http://unused", requestTimeout: 20_000 });
  const os = new OpenSearchProductSearch({ client, alias: name, byId: (id) => byId.get(id), timeoutMs: 10_000 });
  const ids = async (q: Parameters<OpenSearchProductSearch["search"]>[0]) => (await os.search(q)).map((h) => h.product.id);

  beforeAll(async () => {
    await client.indices.create({ index: name, body: { settings: indexSettings, mappings: indexMappings } as never });
    const body = index.products.flatMap((p) => [{ index: { _index: name, _id: p.id } }, toDoc(p)]);
    const res = await client.bulk({ body, refresh: true });
    expect(res.body.errors).toBe(false);
  }, 60_000);

  afterAll(async () => {
    await client.indices.delete({ index: name }).catch(() => undefined);
    await client.close();
  });

  it.each(["lactose-free milk", "laktoositon maito", "laktosfri mjölk"])("%s finds the lactose-free milks first, in three languages", async (text) => {
    expect(new Set(await ids({ text, limit: 5 }))).toEqual(new Set(["900001", "900002", "900003", "900004", "900005"]));
  });

  it("still finds the other kinds when they are asked for", async () => {
    expect(await ids({ text: "lactose free coffee milk", limit: 1 })).toEqual(["900007"]);
    expect(await ids({ text: "laktoositon vispikerma", limit: 1 })).toEqual(["900008"]);
    expect(await ids({ text: "havredryck", limit: 1 })).toEqual(["900016"]);
  });

  it("forgives a typo the in-process search would miss", async () => {
    expect((await ids({ text: "wipping cream", limit: 1 }))[0]).toBe("900008");
  });

  it("unknown allergen data is never treated as free from", async () => {
    const hits = await os.search({ forbiddenAllergens: ["milk"], limit: 50 });
    const got = hits.map((h) => h.product.id);
    expect(got).toContain("900016"); // explicitly free from milk
    expect(got).not.toContain("900017"); // no allergen data: unknown
    expect(got).not.toContain("900002"); // contains milk
    expect(hits.find((h) => h.product.id === "900016")!.allergens).toEqual({ milk: "free_from" });
  });

  it("health counts the documents", async () => {
    expect(await os.health()).toMatchObject({ ok: true, detail: `${index.products.length} products in ${name}` });
  });
});
