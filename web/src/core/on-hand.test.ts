import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./kitchen";
import { bestOnHand, estimateFromHistory, pantryOnHand, saidCovers, saidHave, saidOnHand, shortfall, unknownOnHand } from "./on-hand";

const entry = (date: string, productId: string, packs: number, packSize: number, unit: "L" | "kg" = "L", name = "Lactose-free cream 1 L"): HistoryEntry => ({
  orderId: `o_${date}_${productId}`,
  placedAt: `${date}T06:00:00.000Z`,
  deliveryDate: date,
  family: "cream",
  amount: packs * packSize,
  unit,
  totalCents: packs * 300,
  lines: [{ productId, name, category: "cream", attributes: ["lactose_free"], packs, packSize, unit, unitPriceCents: 300 }],
});

// Six weekly Thursday deliveries of 6 L of cream, the last on Thursday 12 Nov.
const weekly = ["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12"].map((d) => entry(d, "cream_1", 6, 1));
const isCream = (l: { productId: string }) => l.productId === "cream_1";

describe("on hand from the kitchen's own order history", () => {
  it("estimates what is left on the service day from what it bought and how fast it goes through it", () => {
    // 30 L used over the 35 days between the first and the last delivery: about 0.857 L a day.
    const two = estimateFromHistory(weekly, isCream, { amount: 4, unit: "L" }, "2026-11-14")!;
    expect(two.estimate).toBe(true);
    expect(two.source.kind).toBe("bought");
    expect(two.amount).toBeCloseTo(6 - (30 / 35) * 2, 2);
    expect(two.text).toMatch(/^estimate: bought 6 l on Thu 12\.11\. \(6 deliveries\), goes through about 860 ml a day, so about 4\.29 l left by Sat 14\.11\./);
    // A week later the usual use has taken it all: nothing assumed on hand.
    expect(estimateFromHistory(weekly, isCream, { amount: 4, unit: "L" }, "2026-11-20")!.amount).toBe(0);
  });

  it("assumes nothing from a single purchase, unless it is a staple far larger than the need", () => {
    const once = [entry("2026-11-03", "bouillon_1", 1, 1, "kg", "Bouillon powder 1 kg")];
    const match = (l: { productId: string }) => l.productId === "bouillon_1";
    const plain = estimateFromHistory(once, match, { amount: 0.08, unit: "kg" }, "2026-11-20")!;
    expect(plain.amount).toBe(0);
    expect(plain.text).toMatch(/how fast it is used is not known, so nothing is assumed left/);
    const staple = estimateFromHistory(once, match, { amount: 0.08, unit: "kg" }, "2026-11-20", { staple: true })!;
    expect(staple.amount).toBe(1);
    expect(staple.text).toMatch(/a staple far larger than the 80 g this needs, so taken as on hand/);
    // Too long ago, or not much larger than the need: not taken as on hand.
    expect(estimateFromHistory(once, match, { amount: 0.08, unit: "kg" }, "2026-12-20", { staple: true })!.amount).toBe(0);
    expect(estimateFromHistory(once, match, { amount: 0.5, unit: "kg" }, "2026-11-20", { staple: true })!.amount).toBe(0);
  });

  it("is undefined when the kitchen never bought it in this measure, and ignores deliveries after the service day", () => {
    expect(estimateFromHistory(weekly, (l) => l.productId === "other", { amount: 1, unit: "L" }, "2026-11-14")).toBeUndefined();
    expect(estimateFromHistory(weekly, isCream, { amount: 1, unit: "kg" }, "2026-11-14")).toBeUndefined();
    expect(estimateFromHistory(weekly, isCream, { amount: 1, unit: "L" }, "2026-10-01")).toBeUndefined();
  });
});

describe("the shortfall: only what is missing is bought", () => {
  it("subtracts a figure, covers all for 'enough', and never goes below zero", () => {
    expect(shortfall({ amount: 6, unit: "L" }, { ...unknownOnHand("L"), amount: 2.5 }).toBuy).toEqual({ amount: 3.5, unit: "L" });
    expect(shortfall({ amount: 6, unit: "L" }, saidOnHand("I have cream", "L")).covered).toBe(true);
    expect(shortfall({ amount: 1, unit: "L" }, { ...unknownOnHand("L"), amount: 4 }).toBuy.amount).toBe(0);
    // Another measure than the need: nothing assumed.
    expect(shortfall({ amount: 2, unit: "kg" }, saidOnHand("2 L", "L", { amount: 2, unit: "L" })).toBuy).toEqual({ amount: 2, unit: "kg" });
  });

  it("nothing known means nothing on hand, and each figure says where it came from", () => {
    const none = bestOnHand([undefined], "kg");
    expect(none.source.kind).toBe("unknown");
    expect(shortfall({ amount: 3, unit: "kg" }, none).toBuy.amount).toBe(3);
    // What the chef said beats the pantry list, which beats an estimate.
    const est = estimateFromHistory(weekly, isCream, { amount: 4, unit: "L" }, "2026-11-14");
    expect(bestOnHand([est, saidOnHand("we have cream", "L")], "L").source.kind).toBe("said");
    expect(bestOnHand([est, pantryOnHand("cream", "L")], "L").source.kind).toBe("pantry");
    expect(bestOnHand([est], "L").source.kind).toBe("bought");
  });
});

describe("what the chef says they have", () => {
  it("reads the items after 'I have', in English, Finnish and Swedish, with an amount when one is written", () => {
    expect(saidHave("Plan for Friday. I have butter and flour.").map((x) => x.item)).toEqual(["butter", "flour"]);
    expect(saidHave("We already have some cream, onions and 2 kg of potatoes for the soup")).toEqual([
      { words: "some cream", item: "cream" },
      { words: "onions", item: "onions" },
      { words: "2 kg of potatoes", item: "potatoes", amount: { amount: 2, unit: "kg" } },
    ]);
    expect(saidHave("Meillä on jo voita ja 3 l kermaa").map((x) => [x.item, x.amount?.amount])).toEqual([
      ["voita", undefined],
      ["kermaa", 3],
    ]);
    expect(saidHave("Vi har smör och mjöl").map((x) => x.item)).toEqual(["smör", "mjöl"]);
    expect(saidHave("A menu around root vegetables for 40")).toEqual([]);
  });

  it("matches an item to an ingredient by its stems, across inflections", () => {
    expect(saidCovers({ words: "voita", item: "voita" }, ["butter", "voi", "laktoositon voi"])).toBe(true);
    expect(saidCovers({ words: "jauhoja", item: "jauhoja" }, ["wheat flour", "vehnäjauho"])).toBe(true);
    expect(saidCovers({ words: "flour", item: "flour" }, ["wheat flour", "vehnäjauho"])).toBe(true);
    expect(saidCovers({ words: "butter", item: "butter" }, ["rapeseed oil", "rypsiöljy"])).toBe(false);
    expect(saidCovers({ words: "cream", item: "cream" }, ["crème fraîche", "ranskankerma"])).toBe(false);
  });
});
