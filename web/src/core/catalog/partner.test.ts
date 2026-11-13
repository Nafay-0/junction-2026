import { describe, expect, it } from "vitest";
import { buildCatalogIndex, categoryCodesFor, categorySlug, decodeIndex, encodeIndex, isIndexFile, parseNumberCsv } from "./partner";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, rawProduct } from "./test-data";

const NOW = new Date("2026-11-13T10:00:00.000Z");
const build = () => buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV, NOW);
const get = (id: string) => build().products.find((p) => p.id === id)!;

describe("catalogue index", () => {
  it("keeps names in three languages, units, lot size, vendor and substitutes", () => {
    const p = get("900001");
    expect(Object.keys(p.names)).toEqual(["en", "fi", "sv"]);
    expect(p).toMatchObject({ brand: "Tunturi", vendor: "TESTIMEIJERI OY", categoryCode: "10400", salesUnit: "KI", baseUnit: "ST", lotSize: 0.01, substitutes: ["900002"], countryOfOrigin: "fi" });
    expect(p.units).toEqual([{ unit: "KI", baseUnits: 2 }, { unit: "ST", baseUnits: 1 }]);
  });

  it("maps claims to Dock attributes, with the claims they imply", () => {
    expect(get("900001").claims).toEqual(["fat_1_5", "lactose_free", "low_lactose", "vegetarian"]);
    expect(get("900016").claims).toEqual(["lactose_free", "low_lactose", "vegan", "vegetarian"]);
    expect(get("900025").claims).toContain("organic"); // from the EU organic label
  });

  it("keeps labels as certificates and the temperature class apart", () => {
    const p = get("900001");
    expect(p.labels).toEqual(["hyvaa_suomesta"]);
    expect(p.temperature).toEqual({ code: 4, class: "chilled" });
  });

  it("separates contains, may contain and free from; missing data stays unknown", () => {
    expect(get("900001").allergens).toEqual({ declared: true, contains: ["milk"], mayContain: [], freeFrom: ["lactose"] });
    // vegan implies free from milk and eggs; wheat-family cereals imply gluten; GS1 nuts and peanuts are free-from
    expect(get("900016").allergens.contains).toEqual(["gluten", "oats"]);
    expect(get("900016").allergens.freeFrom).toEqual(expect.arrayContaining(["milk", "eggs", "nuts", "peanuts"]));
    expect(get("900025").allergens).toMatchObject({ contains: ["gluten", "gs1:XQ"], mayContain: ["nuts"] }); // unknown code kept
    expect(get("900017").allergens).toEqual({ declared: false, contains: [], mayContain: [], freeFrom: [] });
  });

  it("never lets a free-from statement contradict a contains statement", () => {
    const raw = rawProduct({ id: "1", names: { en: "x 1 l" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], claims: ["VEGAN"], allergens: [["AM", "CONTAINS"]] });
    const [p] = buildCatalogIndex([raw], "", "", NOW).products;
    expect(p.allergens.contains).toEqual(["milk"]);
    expect(p.allergens.freeFrom).not.toContain("milk");
  });

  it("joins delivery reliability and the carbon group average, null when absent or invalid", () => {
    expect(get("900001")).toMatchObject({ deliveryReliability: 0.98, carbonGroupAvgKgCo2ePerKg: 1.1 });
    expect(get("900003")).toMatchObject({ deliveryReliability: null, carbonGroupAvgKgCo2ePerKg: null }); // "abc"
    expect(get("900004").deliveryReliability).toBeNull(); // 1.7 is out of range
  });

  it("skips records that are not products, and duplicates", () => {
    const idx = buildCatalogIndex([...FIXTURE_PRODUCTS, { id: 5 }, null, "x", FIXTURE_PRODUCTS[0], { ...(FIXTURE_PRODUCTS[1] as object), id: "dup", deleted: true }], "", "", NOW);
    expect(idx.stats).toMatchObject({ products: FIXTURE_PRODUCTS.length, skipped: 5 });
    expect(() => buildCatalogIndex({}, "", "", NOW)).toThrow(/array/);
  });

  it("cuts oversize strings from untrusted data", () => {
    const raw = rawProduct({ id: "2", names: { en: `${"a".repeat(5000)} 1 l` }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]] });
    const [p] = buildCatalogIndex([raw], "", "", NOW).products;
    expect(p.names.en!.length).toBeLessThanOrEqual(300);
  });

  it("round-trips through the compact file format", () => {
    const idx = build();
    const file = JSON.parse(JSON.stringify(encodeIndex(idx)));
    expect(isIndexFile(file)).toBe(true);
    expect(decodeIndex(file)).toEqual(idx);
    expect(isIndexFile({ ...file, version: 99 })).toBe(false);
    expect(decodeIndex({ ...file, rows: [...file.rows, ["bad"], null] }).products).toHaveLength(idx.products.length);
  });

  it("keeps every valid GTIN (sales unit and packaging levels), drops bad ones, and carries them through the file", () => {
    const raw = { ...rawProduct({ id: "G1", names: { fi: "Testimaito 1 l" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1], ["PK", 12]] }), salesUnitGtin: "6408430000135" };
    (raw.units as { gtin?: string }[])[1].gtin = "06408430000142"; // a case GTIN-14
    (raw.units as { gtin?: string }[])[0].gtin = "6408430000136"; // bad check digit
    const idx = buildCatalogIndex([raw, rawProduct({ id: "G2", names: { fi: "Ei koodia" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]] })], "", "", NOW);
    expect(idx.products.find((p) => p.id === "G1")!.gtins).toEqual(["6408430000135", "06408430000142"]);
    expect(idx.products.find((p) => p.id === "G2")!.gtins).toEqual([]);
    const file = JSON.parse(JSON.stringify(encodeIndex(idx)));
    expect(decodeIndex(file).products.find((p) => p.id === "G1")!.gtins).toEqual(["6408430000135", "06408430000142"]);
    // An index built before GTINs were kept still loads; its products simply have none.
    const legacy = { ...file, columns: file.columns.slice(0, -1), rows: file.rows.map((r: unknown[]) => r.slice(0, -1)) };
    expect(isIndexFile(legacy)).toBe(true);
    const old = decodeIndex(legacy).products;
    expect(old).toHaveLength(2);
    expect(old[0].gtins).toBeUndefined();
  });

  it("names a few categories and keeps the code for the rest", () => {
    expect(categorySlug("10400")).toBe("milk");
    expect(categorySlug("63235")).toBe("cat_63235");
    expect(categoryCodesFor("milk")).toEqual(["10400"]);
    expect(categoryCodesFor("10401")).toEqual(["10401"]);
    expect(categoryCodesFor("cat_63235")).toEqual(["63235"]);
    expect(categoryCodesFor("nonsense")).toEqual([]);
  });

  it("parses side CSVs defensively", () => {
    const m = parseNumberCsv("productId,x\n1,0.5\n2,\n3,NaN\n4,2\n5;0.1\n\n6, 0.25 \n", [0, 1]);
    expect([...m]).toEqual([["1", 0.5], ["6", 0.25]]);
  });
});
