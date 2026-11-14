/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures build raw partner records. */
import { describe, expect, it } from "vitest";
import { buildCatalogIndex, lotOf, shorten, categoryCodesFor, categorySlug, decodeIndex, encodeIndex, isIndexFile, parseNumberCsv } from "./partner";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, rawProduct } from "./test-data";

const NOW = new Date("2026-11-13T10:00:00.000Z");
const build = () => buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV, NOW);
const get = (id: string) => build().products.find((p) => p.id === id)!;

describe("catalogue index", () => {
  it("keeps names in three languages, units, lot size, vendor and substitutes", () => {
    const p = get("900001");
    expect(Object.keys(p.names)).toEqual(["en", "fi", "sv"]);
    expect(p).toMatchObject({ brand: "Tunturi", vendor: "TESTIMEIJERI OY", categoryCode: "10400", salesUnit: "KI", baseUnit: "ST", lotSize: 1, substitutes: ["900002"], countryOfOrigin: "fi" });
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
    const raw = { ...rawProduct({ id: "G1", names: { fi: "Testimaito 1 l" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1], ["PK", 12]] }), salesUnitGtin: "6408430000135" } as unknown as Record<string, unknown> & { units: { gtin?: string }[] };
    raw.units[1].gtin = "06408430000142"; // a case GTIN-14
    raw.units[0].gtin = "6408430000136"; // bad check digit
    const idx = buildCatalogIndex([raw, rawProduct({ id: "G2", names: { fi: "Ei koodia" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]] })], "", "", NOW);
    expect(idx.products.find((p) => p.id === "G1")!.gtins).toEqual(["6408430000135", "06408430000142"]);
    expect(idx.products.find((p) => p.id === "G2")!.gtins).toEqual([]);
    const file = JSON.parse(JSON.stringify(encodeIndex(idx)));
    expect(decodeIndex(file).products.find((p) => p.id === "G1")!.gtins).toEqual(["6408430000135", "06408430000142"]);
    // An index built before GTINs were kept still loads; its products simply have none.
    const legacy = { ...file, columns: file.columns.slice(0, 22), rows: file.rows.map((r: unknown[]) => r.slice(0, 22)) };
    expect(isIndexFile(legacy)).toBe(true);
    const old = decodeIndex(legacy).products;
    expect(old).toHaveLength(2);
    expect(old[0].gtins).toBeUndefined();
    // An index built before the data-depth fields (23 columns) loads too: GTINs kept, nothing else invented.
    const before = { ...file, columns: file.columns.slice(0, 23), rows: file.rows.map((r: unknown[]) => r.slice(0, 23)) };
    expect(isIndexFile(before)).toBe(true);
    expect(decodeIndex(before).products.find((p) => p.id === "G1")!.gtins).toEqual(["6408430000135", "06408430000142"]);
    expect(isIndexFile({ ...file, columns: file.columns.slice(0, 25), rows: file.rows.map((r: unknown[]) => r.slice(0, 25)) })).toBe(false);
  });

  it("reads nutrition per 100 g or ml, deposits, VAT, texts, origins, the main ingredient and catch reports; absent stays absent", () => {
    const raw = rawProduct({ id: "D1", names: { en: "Test yoghurt 1 kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]] }) as Record<string, any>;
    raw.deposits = [{ material: "4", quantity: 24, unit: "ST" }];
    Object.assign(raw.synkkaData, {
      vatCode: "MEDIUM",
      minTemperature: 2,
      maxTemperature: 6,
      countriesOfOrigin: ["246", "752"],
      keyIngredients: [{ value: "milk, sugar 8 %, strawberry", language: "en" }, { value: "maito, sokeri 8 %, mansikka", language: "fi" }],
      storageInstructions: [{ value: "Keep   at +2...+6 °C", language: "en" }],
      marketingTexts: [{ value: "x".repeat(500), language: "en" }],
      ingredients: [{ sequence: 1, percentage: 80, names: [{ value: "milk", language: "en" }], origins: [{ type: "MILKING", country: "246" }] }],
      fishingReports: [{ id: "sal", name: "salmo salar", catchMethods: [{ methods: ["TM"], areas: ["27.3.d"], productionMethod: "AQUACULTURE1" }] }],
      nutritionalContent: [
        { id: "SALTEQ", value: 0.1, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "GRM", unitPrecision: "APPROXIMATELY" },
        { id: "SUGAR-", value: 11.5, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "GRM" },
        { id: "FASAT", value: 0.5, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "GRM", unitPrecision: "LESS_THAN" },
        { id: "CA", value: 0.12, unit: "GRM", basisQuantity: 100, basisQuantityUnit: "GRM" },
        { id: "PRO-", value: 3.1, unit: "GRM", basisQuantity: 30, basisQuantityUnit: "GRM" }, // per serving: not mixed in
        { id: "ENER-E14", value: 9999, unit: "E14", basisQuantity: 100, basisQuantityUnit: "GRM" }, // implausible: dropped
      ],
    });
    const bare = rawProduct({ id: "D2", names: { en: "Plain" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]] });
    const idx = buildCatalogIndex([raw, bare], "", "", NOW);
    const p = idx.products.find((x) => x.id === "D1")!;
    expect(p.nutrition).toEqual({ per: "100g", values: { saturated_fat: 0.5, sugar: 11.5, salt: 0.1, calcium: 120 }, lessThan: ["saturated_fat"] });
    expect(p.deposits).toEqual([{ material: "4", quantity: 24 }]);
    expect(p.vatRatePct).toBe(13.5);
    expect(p.texts?.ingredients).toEqual({ en: "milk, sugar 8 %, strawberry", fi: "maito, sokeri 8 %, mansikka" });
    expect(p.texts?.storage).toEqual({ en: "Keep at +2...+6 °C" });
    expect(p.texts?.about?.en?.length).toBeLessThanOrEqual(81);
    expect(p.origins).toEqual(["fi", "se"]);
    expect(p.mainIngredient).toEqual({ names: { en: "milk" }, pct: 80, origins: [{ stage: "MILKING", country: "fi" }] });
    expect(p.fish).toEqual([{ species: "SAL", latin: "Salmo salar", production: "aquaculture", methods: ["TM"], areas: ["27.3.d"] }]);
    expect(p.storageTempC).toEqual({ min: 2, max: 6 });
    const q = idx.products.find((x) => x.id === "D2")!;
    for (const k of ["nutrition", "deposits", "vatRatePct", "texts", "mainIngredient", "origins", "fish", "storageTempC"] as const) expect(q[k]).toBeUndefined();
    // Through the file and back, texts included; and without texts when the build leaves them out.
    const file = JSON.parse(JSON.stringify(encodeIndex(idx)));
    expect(decodeIndex(file)).toEqual(idx);
    const lean = decodeIndex(JSON.parse(JSON.stringify(encodeIndex(idx, { omit: ["texts"] }))));
    expect(lean.products.find((x) => x.id === "D1")!.texts).toBeUndefined();
    expect(lean.products.find((x) => x.id === "D1")!.nutrition).toEqual(p.nutrition);
  });

  it("shortens long texts at a comma, never mid-word when it can help it", () => {
    expect(shorten("a, b, c, d", 100)).toBe("a, b, c, d");
    expect(shorten("alpha beta, gamma delta, epsilon zeta", 26)).toBe("alpha beta, gamma delta,…");
  });

  it("reads the partner's lot size as they mean it: 0.01 and none are 1, a real fractional lot is kept", () => {
    expect([0.01, undefined, null, 0, 1, 1.5, 2.5, 3].map((x) => lotOf(x as number | undefined))).toEqual([1, 1, 1, 1, 1, 1.5, 2.5, 3]);
    const old = JSON.parse(JSON.stringify(encodeIndex(build())));
    for (const r of old.rows) r[10] = 0.01; // an index built before the rule
    expect(decodeIndex(old).products.every((p) => p.lotSize === 1)).toBe(true);
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
