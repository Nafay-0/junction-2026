import { describe, expect, it } from "vitest";
import type { Product } from "./catalog";
import { lineCo2Kg, lineMarks, marksSummary, pipsOf } from "./line-marks";

/** A partner product as the catalogue index gives it (core/catalog/product.ts toDockProduct). */
const partner = (over: Partial<Product> & { perSalesUnit?: { L?: number; kg?: number } }): Product => {
  const { perSalesUnit, ...rest } = over;
  return {
    id: "P",
    name: "Product",
    brand: "x",
    category: "milk",
    unit: "L",
    packSize: 1,
    attributes: [],
    allergens: [],
    certificates: [],
    deliveryReliability: 0,
    carbonKgPerUnit: 0,
    source: "valio",
    deliveryReliabilityKnown: false,
    carbonKnown: false,
    carbonGroupAvgKgCo2ePerKg: null,
    packContent: { perSalesUnit: perSalesUnit ?? {}, baseUnitsPerSalesUnit: null, certain: true, certainMeasures: [], issues: [], label: "" },
    ...rest,
  } as Product;
};

describe("a line's delivery record", () => {
  it("a known good record: its share in tenths, not poor", () => {
    const m = lineMarks(partner({ deliveryReliability: 0.93, deliveryReliabilityKnown: true }), 2);
    expect(m.delivery).toEqual({ share: 0.93, n: 9, of: 10, poor: false });
  });
  it("a poor record is marked poor, in the words the agent says (twentieths when tenths would round up)", () => {
    expect(lineMarks(partner({ deliveryReliability: 0.5, deliveryReliabilityKnown: true }), 1).delivery).toEqual({ share: 0.5, n: 5, of: 10, poor: true });
    expect(lineMarks(partner({ deliveryReliability: 0.86, deliveryReliabilityKnown: true }), 1).delivery).toMatchObject({ n: 17, of: 20, poor: true });
  });
  it("the warn level is the caller's (DOCK_RELIABILITY_WARN)", () => {
    expect(lineMarks(partner({ deliveryReliability: 0.93, deliveryReliabilityKnown: true }), 1, 0.95).delivery?.poor).toBe(true);
  });
  it("an unknown record is absent, never 0", () => {
    expect(lineMarks(partner({ deliveryReliability: 0, deliveryReliabilityKnown: false }), 1).delivery).toBeUndefined();
  });
  it("five pips", () => {
    expect([1, 0.95, 0.86, 0.5, 0.05].map(pipsOf)).toEqual([5, 5, 4, 3, 0]);
  });
});

describe("a line's carbon estimate: the group average per kilo times the line's kilos or litres", () => {
  it("kilos", () => {
    expect(lineCo2Kg(partner({ unit: "kg", packSize: 2.5, perSalesUnit: { kg: 2.5 }, carbonGroupAvgKgCo2ePerKg: 4.8 }), 3)).toBe(36);
  });
  it("litres, a litre counted as a kilo", () => {
    expect(lineCo2Kg(partner({ unit: "L", packSize: 10, perSalesUnit: { L: 10 }, carbonGroupAvgKgCo2ePerKg: 1.2 }), 5)).toBe(60);
  });
  it("pieces without a weight: nothing", () => {
    expect(lineCo2Kg(partner({ unit: "pcs", packSize: 12, perSalesUnit: {}, carbonGroupAvgKgCo2ePerKg: 3 }), 2)).toBeUndefined();
    expect(lineMarks(partner({ unit: "pcs", packSize: 12, perSalesUnit: {}, carbonGroupAvgKgCo2ePerKg: 3 }), 2)).toEqual({});
  });
  it("a group with no figure: nothing (never 0)", () => {
    expect(lineCo2Kg(partner({ unit: "L", packSize: 1, perSalesUnit: { L: 1 }, carbonGroupAvgKgCo2ePerKg: null }), 4)).toBeUndefined();
  });
  it("the sample assortment's own per-litre figure", () => {
    expect(lineCo2Kg({ unit: "L", packSize: 10, carbonKgPerUnit: 1.05 } as Product, 2)).toBe(21);
  });
});

describe("the list's summary", () => {
  it("counts poor records and adds the known estimates", () => {
    const s = marksSummary([{ delivery: { share: 0.98, n: 10, of: 10, poor: false }, co2Kg: 12 }, { delivery: { share: 0.5, n: 5, of: 10, poor: true }, co2Kg: 20.5 }, undefined]);
    expect(s).toEqual({ lines: 3, withRecord: 2, poor: 1, co2Kg: 32.5, co2Lines: 2 });
  });
  it("nothing known: no footprint", () => {
    expect(marksSummary([undefined, {}])).toEqual({ lines: 2, withRecord: 0, poor: 0, co2Lines: 0 });
  });
});
