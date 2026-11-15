import { afterEach, describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { optionView } from "./cards";
import { marksFor, optionMarks, setMarkProducts } from "./marks";
import type { OptionCard } from "@/core/options";

const p = (id: string, deliveryReliability: number, carbonKgPerUnit: number): Product => ({ id, name: id, brand: "x", category: "milk", unit: "L", packSize: 10, attributes: [], allergens: [], certificates: [], deliveryReliability, carbonKgPerUnit });
const products = new Map([p("A", 0.98, 1), p("B", 0.5, 2), p("C", 0, 0)].map((x) => [x.id, x]));

describe("a card line's marks, from the registered catalogue", () => {
  afterEach(() => setMarkProducts(undefined));
  it("without a catalogue: no marks (the card is drawn as before)", () => {
    expect(marksFor("A", 1)).toEqual({});
  });
  it("a line: its record and its estimate; an unknown product: nothing", () => {
    setMarkProducts((id) => products.get(id));
    expect(marksFor("A", 2)).toEqual({ marks: { delivery: { share: 0.98, n: 10, of: 10, poor: false }, co2Kg: 20 } });
    expect(marksFor("C", 2)).toEqual({});
    expect(marksFor("Z", 2)).toEqual({});
  });
  it("an option: the weakest record, the footprint only when every line has one", () => {
    setMarkProducts((id) => products.get(id));
    expect(optionMarks([{ productId: "A", quantity: 1 }, { productId: "B", quantity: 1 }]).marks).toEqual({ delivery: { share: 0.5, n: 5, of: 10, poor: true }, co2Kg: 30 });
    expect(optionMarks([{ productId: "A", quantity: 1 }, { productId: "C", quantity: 1 }]).marks).toEqual({ delivery: { share: 0.98, n: 10, of: 10, poor: false } });
  });
  it("an option card: its footprint is the ranking's own figure, the one its 'Lowest carbon' label comes from", () => {
    setMarkProducts((id) => products.get(id));
    const option = (kg: number | null) => ({ optionId: "o", rank: 1, title: "t", match: "exact", givesUp: [], totalCents: 100, deliveryDate: "2026-11-16", stockConfirmed: true, lines: [{ productId: "A", name: "A", packs: 1, packSize: 10, unit: "L", unitPriceCents: 100 }], delivered: { amount: 10, unit: "L" }, co2: kg === null ? { kg: null, basis: "missing" } : { kg, basis: "product_group_average" }, reliability: 0.98, signOff: false, pros: [], cons: [] }) as unknown as OptionCard;
    expect(optionView(option(10.3)).marks?.co2Kg).toBe(10.3); // not the lines' 10 (a litre counted as a kilo)
    expect(optionView(option(null)).marks?.co2Kg).toBe(10); // the ranking has no figure: the lines' estimate stands
    setMarkProducts(undefined);
    expect(optionView(option(10.3)).marks).toBeUndefined(); // without a catalogue the card is drawn as before
  });
});
