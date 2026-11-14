import { describe, expect, it } from "vitest";
import { leftoverNote, orderByFit, packFit } from "./pack-choice";

const fmt = (a: number, u: string) => (u === "kg" && a < 1 ? `${Math.round(a * 1000)} g` : `${a} ${u}`);

describe("pack choice for a small need", () => {
  it("counts packs and what is left over", () => {
    expect(packFit(0.08, 1.5)).toEqual({ packs: 1, delivered: 1.5, leftover: 1.42, leftoverShare: 0.947 });
    expect(packFit(7, 2)).toEqual({ packs: 4, delivered: 8, leftover: 1, leftoverShare: 0.125 });
    expect(packFit(0, 1).packs).toBe(0);
  });

  it("80 g of bouillon: the smallest covering pack goes first among products that fit as well (the 1.5 kg defect)", () => {
    const found = [
      { id: "tub_1_5kg", score: 1, packSize: 1.5 },
      { id: "bucket_10kg", score: 0.95, packSize: 10 },
      { id: "jar_500g", score: 0.9, packSize: 0.5 },
      { id: "far_off_100g", score: 0.4, packSize: 0.1 },
    ];
    expect(orderByFit(found, 0.08).map((x) => x.id)).toEqual(["jar_500g", "tub_1_5kg", "bucket_10kg", "far_off_100g"]);
  });

  it("leaves the order alone when the need fills the packs, and never adds or drops a product", () => {
    const found = [
      { id: "a", score: 1, packSize: 1 },
      { id: "b", score: 0.9, packSize: 10 },
      { id: "c", score: 0.85, packSize: undefined },
    ];
    expect(orderByFit(found, 12).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(orderByFit(found, 0.05).map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
    expect(orderByFit(found, undefined).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("says what is left over only when even that pack is far more than the need", () => {
    expect(leftoverNote(0.08, 0.5, "kg", fmt)).toBe("1 × 500 g for 80 g: about 420 g left over, the smallest pack found that covers it");
    expect(leftoverNote(0.9, 1, "kg", fmt)).toBeUndefined();
    expect(leftoverNote(7, 2, "kg", fmt)).toBeUndefined();
  });
});
