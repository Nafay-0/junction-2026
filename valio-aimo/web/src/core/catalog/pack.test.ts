import { describe, expect, it } from "vitest";
import { amountToSalesUnits, derivePackContent, parsePackName, salesUnitsToAmount, type PackFacts, type PackInfo } from "./pack";
import { buildCatalogIndex } from "./partner";
import { FIXTURE_CARBON_CSV, FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV } from "./test-data";

const index = buildCatalogIndex(FIXTURE_PRODUCTS, FIXTURE_RELIABILITY_CSV, FIXTURE_CARBON_CSV);
const pack = (id: string) => {
  const p = index.products.find((x) => x.id === id)!;
  return { ...p.pack, lotSize: p.lotSize } satisfies PackInfo;
};
const litres = (amount: number) => ({ amount, unit: "L" as const });
const kilos = (amount: number) => ({ amount, unit: "kg" as const });

describe("parsePackName", () => {
  it.each([
    ["milk drink 10 l bag-in-box", { L: 10 }, { L: 10 }, undefined],
    ["kevytmaito 1,75 l", { L: 1.75 }, { L: 1.75 }, undefined],
    ["milk 5 dl", { L: 0.5 }, { L: 0.5 }, undefined],
    ["milk 2,5 dl UHT", { L: 0.25 }, { L: 0.25 }, undefined],
    ["portion milk 100x2 cl", { L: 0.02 }, { L: 2 }, 100],
    ["12 x whole milk 1 L", { L: 1 }, { L: 12 }, 12],
    ["70xchocolate bar 18g", { kg: 0.018 }, { kg: 1.26 }, 70],
    ["candy bag 220gx18", { kg: 0.22 }, { kg: 3.96 }, 18],
    ["bread 6x500g", { kg: 0.5 }, { kg: 3 }, 6],
    ["pancake 60 g x 100 / 6 kg", { kg: 0.06 }, { kg: 6 }, 100],
    ["buns 22x45g/990g", { kg: 0.045 }, { kg: 0.99 }, 22],
    ["patties 70 g / 5,6 kg", { kg: 0.07 }, { kg: 5.6 }, 80],
    ["salami 400g", { kg: 0.4 }, { kg: 0.4 }, undefined],
    ["ice cream 5000 ml/2840 g", { L: 5, kg: 2.84 }, { L: 5, kg: 2.84 }, undefined],
    ["sauce 4,6kg/4L", { L: 4, kg: 4.6 }, { L: 4, kg: 4.6 }, undefined],
    ["ice cream stick 100ml/84g x 20", { L: 0.1, kg: 0.084 }, { L: 2, kg: 1.68 }, 20],
    ["ice cream 5L (2x2,5L)", { L: 2.5 }, { L: 5 }, 2],
  ])("reads %s", (name, item, total, count) => {
    const p = parsePackName(name);
    expect(p.item).toEqual(item);
    expect(p.total).toEqual(total);
    expect(p.count).toBe(count);
    expect(p.ambiguous).toBe(false);
  });

  it("treats size ranges as piece sizes, not pack content", () => {
    expect(parsePackName("shrimp 1kg 30-40g frozen")).toMatchObject({ total: { kg: 1 }, ranges: 1, ambiguous: false });
    expect(parsePackName("fillet 200-400g")).toMatchObject({ total: {}, ranges: 1 });
  });

  it("flags names it cannot read safely", () => {
    expect(parsePackName("4 x 6 x mineral water 0,33 l").ambiguous).toBe(true); // nested packs
    expect(parsePackName("olives 400/210 g").ambiguous).toBe(true); // gross and drained weight
    expect(parsePackName("cod 5 kg, 150 g +/- 10 g").ambiguous).toBe(true); // three weights
    expect(parsePackName("roast beef ca 3 kg").approximate).toBe(true);
    expect(parsePackName("chicken fillet app15kg")).toMatchObject({ total: { kg: 15 }, approximate: true });
  });

  it("ignores things that look like sizes but are not", () => {
    expect(parsePackName("whisk 33cm").total).toEqual({});
    expect(parsePackName("milk 1,5 % fat").total).toEqual({});
    expect(parsePackName("12 lasia").total).toEqual({});
    expect(parsePackName("Valio® milk™ 1 l").total).toEqual({ L: 1 });
  });
});

describe("derivePackContent", () => {
  const facts = (over: Partial<PackFacts>): PackFacts => ({ salesUnit: "ST", baseUnit: "ST", units: [{ unitId: "ST", sizeInBaseUnits: 1 }], names: [], ...over });

  it("multiplies the base unit content by the sales unit size", () => {
    expect(pack("900001")).toMatchObject({ perSalesUnit: { L: 20 }, baseUnitsPerSalesUnit: 2, certain: true, label: "2 x 10 l = 20 l per KI" });
    expect(pack("900004")).toMatchObject({ perSalesUnit: { L: 21 }, certain: true });
    expect(pack("900005")).toMatchObject({ perSalesUnit: { L: 3.75 }, certain: true });
  });

  it("reads '12 x 1 L' as twelve one-litre items when a unit of twelve exists", () => {
    expect(pack("900003")).toMatchObject({ perSalesUnit: { L: 12 }, certain: true });
  });

  it("reads a portion box whose base unit is the case as the whole box", () => {
    expect(pack("900006")).toMatchObject({ salesUnit: "KI", perSalesUnit: { L: 2 }, certain: true });
  });

  it("is certain in litres and in kilograms when GS1 confirms both", () => {
    expect(pack("900002")).toMatchObject({ perSalesUnit: { L: 1, kg: 1.03 }, certainMeasures: ["L", "kg"], sources: ["name", "gs1.each"] });
  });

  it("uses a ZML unit as one litre", () => {
    expect(pack("900023")).toMatchObject({ perSalesUnit: { L: 20 }, certain: true, sources: ["name", "units.ZML"] });
    const conflicting = derivePackContent(facts({ names: ["milk 20 l box"], units: [{ unitId: "ST", sizeInBaseUnits: 1 }, { unitId: "ZML", sizeInBaseUnits: 0.1 }] }));
    expect(conflicting).toMatchObject({ certain: false, issues: ["sources_disagree"] });
  });

  it("a KG sales unit is one kilogram, whatever the piece weighs", () => {
    expect(pack("900014")).toMatchObject({ perSalesUnit: { kg: 1 }, primary: "kg", certain: true, issues: [] });
  });

  it("refuses certainty on approximate, conflicting, ambiguous or incomplete data", () => {
    expect(pack("900013")).toMatchObject({ certain: false, issues: ["approximate"] });
    expect(pack("900012")).toMatchObject({ certain: false, issues: ["name_ambiguous"] });
    expect(pack("900015")).toMatchObject({ certain: false, issues: ["case_content_unclear"] });
    expect(pack("900017")).toMatchObject({ certain: false, issues: ["no_content_data"], primary: null });
    expect(pack("900018")).toMatchObject({ certain: false, issues: ["sources_disagree"] });
    expect(pack("900022")).toMatchObject({ certain: false, issues: ["name_ambiguous"] });
    expect(pack("900024")).toMatchObject({ certain: false, issues: ["sales_unit_not_in_hierarchy"], baseUnitsPerSalesUnit: null, perSalesUnit: {} });
  });

  it("lets GS1 piece counts settle '24 pcs 100 g' in a case", () => {
    expect(pack("900021")).toMatchObject({ perSalesUnit: { kg: 2.4 }, certain: true });
    const noGs1 = derivePackContent(facts({ salesUnit: "KI", baseUnit: "KI", units: [{ unitId: "KI", sizeInBaseUnits: 1 }], names: ["donut 24 pcs 100 g"] }));
    expect(noGs1.certain).toBe(false);
  });

  it("flags names that disagree between languages", () => {
    const c = derivePackContent(facts({ names: ["macarons 120g", "macarons 120g", "macarons 132g"] }));
    expect(c).toMatchObject({ certain: false, issues: ["names_disagree"] });
    const sameItem = derivePackContent(facts({ salesUnit: "KI", units: [{ unitId: "KI", sizeInBaseUnits: 24 }, { unitId: "ST", sizeInBaseUnits: 1 }], names: ["24 x water 0,5 L", "24 water 0,5 L"] }));
    expect(sameItem).toMatchObject({ certain: true, perSalesUnit: { L: 12 } });
  });

  it("flags a multiplier no unit in the hierarchy matches", () => {
    const c = derivePackContent(facts({ salesUnit: "KI", units: [{ unitId: "KI", sizeInBaseUnits: 10 }, { unitId: "ST", sizeInBaseUnits: 1 }], names: ["6 x yoghurt 150 g"] }));
    expect(c).toMatchObject({ certain: false, issues: ["count_mismatch"] });
  });

  it("prefers a net weight over a weight written into the volume field", () => {
    const c = derivePackContent(facts({ names: ["garlic flakes 5kg"], each: { volume: { value: 5, unit: "GRM" }, netWeight: { value: 5, unit: "KGM" } } }));
    expect(c).toMatchObject({ certain: true, perSalesUnit: { kg: 5 } });
  });
});

describe("amountToSalesUnits", () => {
  it("1,000 litres of 10 l boxes sold in cases of two is 50 cases", () => {
    const c = amountToSalesUnits(pack("900001"), litres(1000));
    expect(c).toMatchObject({ ok: true, salesUnits: 50, salesUnit: "KI", delivered: litres(1000), difference: 0, warnings: [] });
    if (c.ok) expect(c.explanation).toBe("1000 l = 50 KI x 20 l (2 x 10 l = 20 l per KI).");
  });

  it("rounds up to whole cases and says what is delivered", () => {
    expect(amountToSalesUnits(pack("900004"), litres(1000))).toMatchObject({ ok: true, salesUnits: 48, delivered: litres(1008), difference: 8 });
    expect(amountToSalesUnits(pack("900005"), litres(1000))).toMatchObject({ ok: true, salesUnits: 267, delivered: litres(1001.25) });
    expect(amountToSalesUnits(pack("900003"), litres(1000))).toMatchObject({ ok: true, salesUnits: 84, delivered: litres(1008) });
    expect(amountToSalesUnits(pack("900002"), litres(1000))).toMatchObject({ ok: true, salesUnits: 1000, salesUnit: "ST" });
  });

  it("does not drift on decimal sizes", () => {
    // 0.25 l x 15 = 3.75 l; 7.5 l is exactly two cases, not three.
    expect(amountToSalesUnits(pack("900005"), litres(7.5))).toMatchObject({ ok: true, salesUnits: 2, difference: 0 });
    expect(amountToSalesUnits(pack("900006"), litres(0.3 * 20))).toMatchObject({ ok: true, salesUnits: 3, difference: 0 });
  });

  it("supports rounding down and to nearest", () => {
    expect(amountToSalesUnits(pack("900004"), litres(1000), { rounding: "down" })).toMatchObject({ ok: true, salesUnits: 47, difference: -13 });
    expect(amountToSalesUnits(pack("900004"), litres(1000), { rounding: "nearest" })).toMatchObject({ ok: true, salesUnits: 48 });
    expect(amountToSalesUnits(pack("900004"), litres(5), { rounding: "down" })).toMatchObject({ ok: false, reason: "below_one_step" });
  });

  it("warns when whole cases add a lot on top", () => {
    const c = amountToSalesUnits(pack("900001"), litres(25));
    expect(c).toMatchObject({ ok: true, salesUnits: 2, delivered: litres(40) });
    if (c.ok) expect(c.warnings[0]).toMatch(/adds 15 l \(\+60 %\)/);
  });

  it("honours the lot size: 0.01 and none are one sales unit, a real fractional lot is kept", () => {
    // Sold by the kilo in steps of 1.5 kg: 10 kg is seven steps, 10.5 kg (the data's lot, not rounded to whole kilos).
    expect(amountToSalesUnits(pack("900014"), kilos(10))).toMatchObject({ ok: true, salesUnits: 10.5, step: 1.5, delivered: kilos(10.5) });
    expect(amountToSalesUnits(pack("900014"), kilos(10), { wholeUnits: true })).toMatchObject({ ok: true, salesUnits: 12, step: 3 });
    expect(amountToSalesUnits(pack("900026"), kilos(9))).toMatchObject({ ok: true, salesUnits: 10, step: 2 });
    // "You should treat 0.01 as 1": a weight product with the partner's 0.01 is ordered in whole kilos.
    const kg = (lotSize?: number) => ({ salesUnit: "KG", perSalesUnit: { kg: 1 }, certainMeasures: ["kg" as const], issues: [], label: "1 kg per KG", ...(lotSize !== undefined ? { lotSize } : {}) });
    expect(amountToSalesUnits(kg(0.01), kilos(2.3))).toMatchObject({ ok: true, salesUnits: 3, step: 1 });
    expect(amountToSalesUnits(kg(undefined), kilos(2.3))).toMatchObject({ ok: true, salesUnits: 3, step: 1 });
    expect(amountToSalesUnits(kg(1), kilos(2.3))).toMatchObject({ ok: true, salesUnits: 3, step: 1 });
    expect(amountToSalesUnits(kg(1.5), kilos(2.3))).toMatchObject({ ok: true, salesUnits: 3, step: 1.5 });
    expect(amountToSalesUnits(kg(2.5), kilos(6))).toMatchObject({ ok: true, salesUnits: 7.5, step: 2.5 });
  });

  it("refuses to guess when the content is uncertain, but gives an estimate", () => {
    const c = amountToSalesUnits(pack("900015"), kilos(20));
    expect(c).toMatchObject({ ok: false, reason: "content_uncertain", estimate: { salesUnits: 10, delivered: kilos(20) } });
    if (!c.ok) expect(c.message).toMatch(/Ask a human/);
    expect(amountToSalesUnits(pack("900013"), kilos(30))).toMatchObject({ ok: false, reason: "content_uncertain" });
  });

  it("refuses when the content is unknown or only known in the other measure", () => {
    expect(amountToSalesUnits(pack("900017"), litres(5))).toMatchObject({ ok: false, reason: "content_unknown" });
    expect(amountToSalesUnits(pack("900009"), litres(50))).toMatchObject({ ok: false, reason: "measure_not_known" });
    expect(amountToSalesUnits(pack("900024"), kilos(5))).toMatchObject({ ok: false, reason: "content_unknown" });
  });

  it("converts in the second measure only when that one is certain too", () => {
    expect(amountToSalesUnits(pack("900002"), kilos(103))).toMatchObject({ ok: true, salesUnits: 100 });
    expect(amountToSalesUnits(pack("900001"), kilos(100))).toMatchObject({ ok: false, reason: "measure_not_known" });
  });

  it("rejects nonsense amounts", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(amountToSalesUnits(pack("900001"), litres(bad))).toMatchObject({ ok: false, reason: "invalid_amount" });
    }
  });
});

describe("salesUnitsToAmount", () => {
  it("converts back and checks the order step", () => {
    expect(salesUnitsToAmount(pack("900001"), 50, "L")).toMatchObject({ ok: true, amount: litres(1000) });
    expect(salesUnitsToAmount(pack("900001"), 2.5, "L")).toMatchObject({ ok: false, reason: "invalid_quantity" });
    expect(salesUnitsToAmount(pack("900014"), 4.5, "kg")).toMatchObject({ ok: true, amount: kilos(4.5) }); // three steps of 1.5 kg
    expect(salesUnitsToAmount(pack("900014"), 4, "kg")).toMatchObject({ ok: false, reason: "invalid_quantity" });
    expect(salesUnitsToAmount(pack("900014"), 4.5, "kg", { wholeUnits: true })).toMatchObject({ ok: false, reason: "invalid_quantity" });
    expect(salesUnitsToAmount(pack("900015"), 3, "kg")).toMatchObject({ ok: false, reason: "content_uncertain", estimate: kilos(6) });
    expect(salesUnitsToAmount(pack("900001"), 0, "L")).toMatchObject({ ok: false, reason: "invalid_quantity" });
  });

  it("round-trips every certain fixture product", () => {
    for (const p of index.products.filter((x) => x.pack.certain)) {
      const info = { ...p.pack, lotSize: p.lotSize };
      const unit = p.pack.primary!;
      const there = amountToSalesUnits(info, { amount: 100, unit });
      expect(there.ok, p.id).toBe(true);
      if (!there.ok) continue;
      const back = salesUnitsToAmount(info, there.salesUnits, unit);
      expect(back).toMatchObject({ ok: true, amount: there.delivered });
      expect(there.delivered.amount).toBeGreaterThanOrEqual(100);
    }
  });
});
