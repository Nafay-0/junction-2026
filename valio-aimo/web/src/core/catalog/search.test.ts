import { describe, expect, it } from "vitest";
import { buildCatalogIndex } from "./partner";
import { LexicalSearch, fold, parseQueryText } from "./search";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV } from "./test-data";

const index = buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV);
const search = new LexicalSearch(index.products);
const ids = (q: Parameters<LexicalSearch["search"]>[0]) => search.search(q).map((h) => h.product.id);

const LF_MILKS = ["900001", "900002", "900003", "900004", "900005"];
const NOT_PLAIN_MILK = ["900006", "900007", "900008", "900009", "900010", "900011"]; // portions, coffee milk, cream, yoghurt, sour milk, not lactose-free

describe("parseQueryText", () => {
  it("pulls out claims in three languages", () => {
    expect(parseQueryText("lactose-free milk")).toMatchObject({ terms: ["milk"], claims: ["lactose_free"] });
    expect(parseQueryText("laktoositon maito")).toMatchObject({ terms: ["maito"], claims: ["lactose_free"] });
    expect(parseQueryText("laktosfri mjölk")).toMatchObject({ terms: ["mjolk"], claims: ["lactose_free"] });
    expect(parseQueryText("gluteeniton vegaaninen leipä")).toMatchObject({ terms: ["leipa"], claims: ["gluten_free", "vegan"] });
    expect(parseQueryText("dairy-free dessert").excludeAllergens).toEqual(["milk"]);
  });

  it("reads amounts: small ones as pack size, large ones as the order", () => {
    expect(parseQueryText("I need 1,000 litres of lactose-free milk by Monday")).toMatchObject({ terms: ["milk"], orderAmount: { amount: 1000, unit: "L" } });
    expect(parseQueryText("1 000 l milk").orderAmount).toEqual({ amount: 1000, unit: "L" });
    expect(parseQueryText("milk 1,5 l").packSize).toEqual({ amount: 1.5, unit: "L" });
    expect(parseQueryText("milk 10 L").packSize).toEqual({ amount: 10, unit: "L" });
    expect(parseQueryText("cream 2 dl").packSize).toEqual({ amount: 0.2, unit: "L" });
    expect(parseQueryText("flour 50 kg").orderAmount).toEqual({ amount: 50, unit: "kg" });
  });

  it("folds Nordic letters", () => {
    expect(fold("Mjölk ÅÄÖ é®")).toBe("mjolk aao e ");
  });
});

describe("LexicalSearch", () => {
  it.each(["lactose-free milk", "laktoositon maito", "laktosfri mjölk", "I need 1,000 litres of lactose-free milk by Monday"])(
    "%s finds the lactose-free milks first, not cream, yoghurt, sour milk, coffee milk or portions",
    (text) => {
      const hits = ids({ text, limit: 5 });
      expect(new Set(hits)).toEqual(new Set(LF_MILKS));
      for (const id of NOT_PLAIN_MILK) expect(hits).not.toContain(id);
    },
  );

  it("still finds the other kinds when they are asked for", () => {
    expect(ids({ text: "lactose free coffee milk", limit: 1 })).toEqual(["900007"]);
    expect(ids({ text: "laktoositon vispikerma", limit: 1 })).toEqual(["900008"]);
    expect(ids({ text: "portion milk", limit: 1 })).toEqual(["900006"]);
    expect(ids({ text: "piimä", limit: 1 })).toEqual(["900010"]);
  });

  it("a large order prefers big packs; a pack size in the query is matched", () => {
    expect(ids({ text: "1000 l lactose free milk", limit: 2 })).toEqual(["900004", "900001"]);
    expect(ids({ text: "lactose-free milk 10 l", limit: 1 })).toEqual(["900001"]);
  });

  it("filters by required claims, category and pack content", () => {
    expect(ids({ text: "milk", requiredClaims: ["lactose_free"], category: "milk", minPackContent: { amount: 10, unit: "L" } })).toEqual(
      expect.arrayContaining(["900001", "900003", "900004"]),
    );
    expect(ids({ text: "milk", minPackContent: { amount: 10, unit: "L" } })).not.toContain("900012"); // uncertain content never qualifies
    expect(ids({ category: "10402" })).toEqual(["900016"]);
    expect(ids({ text: "milk", requiredClaims: ["vegan"] })).toEqual([]);
  });

  it("treats missing allergen data as unknown, never as safe", () => {
    const hits = search.search({ forbiddenAllergens: ["gluten"], limit: 100 });
    const found = hits.map((h) => h.product.id);
    expect(found).not.toContain("900017"); // no allergen data at all
    expect(found).not.toContain("900016"); // contains gluten
    expect(found).not.toContain("900025"); // contains gluten
    expect(found).toContain("900001"); // has allergen data, gluten not listed
    expect(hits.find((h) => h.product.id === "900001")!.allergens).toEqual({ gluten: "not_declared" });
  });

  it("excludes 'may contain' and can demand explicit free-from statements", () => {
    expect(ids({ text: "granola", forbiddenAllergens: ["nuts"] })).toEqual([]);
    expect(ids({ text: "oat drink", forbiddenAllergens: ["nuts"], allergenProof: "free_from" })).toEqual(["900016"]);
    expect(ids({ text: "milk", forbiddenAllergens: ["nuts"], allergenProof: "free_from" })).toEqual([]);
    expect(ids({ text: "dairy free oat drink" })).toEqual(["900016"]);
  });

  it("looks up ids directly and respects the limit", () => {
    expect(ids({ ids: ["900002", "nope", "900001"] }).sort()).toEqual(["900001", "900002"]);
    expect(ids({ text: "milk", limit: 2 })).toHaveLength(2);
    expect(ids({ limit: 1000 }).length).toBeLessThanOrEqual(100);
  });

  it("falls back to partial matches when nothing matches every word", () => {
    const hits = search.search({ text: "tunturi whipping cream zzzz" });
    expect(hits[0].product.id).toBe("900008");
    expect(hits[0].why.join()).toMatch(/no match for zzzz/);
  });

  it("explains its ranking", () => {
    const sour = search.search({ text: "lactose free milk", limit: 20 }).find((h) => h.product.id === "900010")!;
    expect(sour.why.join(" ")).toMatch(/fermented not asked for/);
  });
});
