import { describe, expect, it } from "vitest";
import type { Product } from "../catalog";
import { piecesPerSalesUnit } from "./product";

const base: Product = { id: "X", name: "x", brand: "b", category: "eggs", unit: "kg", packSize: 1, attributes: [], allergens: [], certificates: [], deliveryReliability: 0, carbonKgPerUnit: 0 };
const partner = (en: string, salesUnit: string, baseUnit: string, factor: number, fi?: string): Product => ({
  ...base,
  name: en,
  names: { en, ...(fi ? { fi } : {}) },
  salesUnit,
  baseUnit,
  packContent: { perSalesUnit: { kg: 1 }, baseUnitsPerSalesUnit: factor, certain: true, certainMeasures: ["kg"], issues: [], label: "1 kg" },
});

describe("pieces per sales unit (menu planner hook: count eggs and tortillas, never packages)", () => {
  it("reads the partner's egg size codes and multipacks, reconciled with the packaging hierarchy", () => {
    expect(piecesPerSalesUnit(partner("Barn egg M10 580g", "RAS", "RAS", 1))).toBe(10);
    expect(piecesPerSalesUnit(partner("Barn Eggs L180 12300g", "KI", "KI", 1))).toBe(180);
    expect(piecesPerSalesUnit(partner("20 x Barn egg L6 408g", "KI", "RAS", 20))).toBe(120);
    expect(piecesPerSalesUnit(partner("wheat tortilla 30cm 8x18pc", "KI", "BAG", 8))).toBe(144);
    expect(piecesPerSalesUnit(partner("wheat tortilla 16,3cm 18pc", "BAG", "BAG", 1))).toBe(18);
    expect(piecesPerSalesUnit(partner("Fried barn egg 80 pcs, 2,88 kg. Frozen.", "KI", "KI", 1))).toBe(80);
  });

  it("says nothing when the data does not decide it", () => {
    expect(piecesPerSalesUnit(partner("wheat tortilla 18pc", "KI", "BAG", 8))).toBeUndefined(); // per bag or per case?
    expect(piecesPerSalesUnit(partner("8 x 18pc tortilla", "KI", "BAG", 6))).toBeUndefined(); // name and case disagree
    expect(piecesPerSalesUnit(partner("Whole milk 1 l", "ST", "ST", 1))).toBeUndefined();
    expect(piecesPerSalesUnit(partner("Mixed bread slices, 2pcs, singlepacked 40x40g", "KI", "KI", 1))).toBeUndefined(); // 2 or 80?
    expect(piecesPerSalesUnit(partner("Pork cutlet 120g/10pcs", "KG", "KG", 1))).toBeUndefined(); // sold by the kilo
    expect(piecesPerSalesUnit(partner("Liquid whole egg 1000 g", "ST", "ST", 1))).toBeUndefined(); // an egg product, not eggs
    expect(piecesPerSalesUnit(partner("Egg cutter L12 steel", "ST", "ST", 1))).toBeUndefined(); // egg codes come with the pack weight
  });

  it("counts a seed product in pieces by its own unit", () => {
    expect(piecesPerSalesUnit({ ...base, unit: "pcs", packSize: 30 })).toBe(30);
    expect(piecesPerSalesUnit({ ...base, unit: "L", packSize: 10 })).toBeUndefined();
  });
});
