import { describe, expect, it } from "vitest";
import { InMemoryCatalog } from "./catalog";
import { qualifiersOf, wordsNotCarried } from "./qualifiers";
import { SEED_PRODUCTS, SEED_STOCK } from "./seed";

const catalog = new InMemoryCatalog(SEED_PRODUCTS, SEED_STOCK, () => new Date("2026-11-13T10:00:00Z"));
const idOf = (name: RegExp) => SEED_PRODUCTS.find((p) => name.test(p.name))!.id;

describe("the words that say which kind of product was asked for", () => {
  it("finds a word that narrows the family, and which products carry it", async () => {
    const q = await qualifiersOf(catalog, "milk", "Arla milk");
    expect(q.words.map((w) => w.word)).toEqual(["arla"]);
    expect(wordsNotCarried(q, idOf(/^Arla .*10 L/))).toEqual([]);
    expect(wordsNotCarried(q, idOf(/^Valio Eila .*10 L/))).toEqual(["arla"]);
  });

  it("names a word nothing in the family carries", async () => {
    const q = await qualifiersOf(catalog, "milk", "camel milk");
    expect(q.absent).toEqual(["camel"]);
    expect(wordsNotCarried(q, idOf(/^Valio Eila .*10 L/))).toEqual(["camel"]);
  });

  it("reads a plural the catalogue names in the singular as the same word", async () => {
    const q = await qualifiersOf(catalog, "milk", "Arlas milk");
    expect(q.absent).toEqual([]);
    expect(wordsNotCarried(q, idOf(/^Arla .*10 L/))).toEqual([]);
  });

  it("reads a country said as a word against the products of that origin", async () => {
    const q = await qualifiersOf(catalog, "milk", "Finnish milk");
    for (const w of q.words) expect(w.word).toBe("finnish");
  });

  it("does not count the family, a claim or a generic quality", async () => {
    expect((await qualifiersOf(catalog, "milk", "lactose-free milk")).words).toEqual([]);
    expect((await qualifiersOf(catalog, "milk", "fresh organic milk")).words).toEqual([]);
  });
});
