import { afterEach, describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { marksFor, optionMarks, setMarkProducts } from "./marks";

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
});
