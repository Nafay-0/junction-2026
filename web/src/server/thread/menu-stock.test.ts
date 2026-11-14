import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/core/kitchen";
import { inSeason, langOf, seasonalIn, seasonText } from "@/server/agent/menu/season";
import { stockFromRecords } from "./menu-stock";

const delivery = (deliveryDate: string, productId: string, packs: number, packSize = 1, unit: "kg" | "L" = "kg", name = "Valio whipping cream 1 l", category = "cream"): HistoryEntry => ({
  orderId: `o_${deliveryDate}_${productId}`,
  placedAt: `${deliveryDate}T08:00:00Z`,
  deliveryDate,
  family: category,
  amount: packs * packSize,
  unit,
  totalCents: 1000,
  lines: [{ productId, name, category, attributes: [], packs, packSize, unit, unitPriceCents: 100 }],
});

describe("what the kitchen probably still has", () => {
  const line = { lineId: "l1", name: "whipping cream", need: { amount: 4, unit: "L" }, productIds: ["C1"], category: "cream", kindWords: ["whipping", "cream"] };

  it("counts a line as in stock when what is likely left of the last delivery covers the need", () => {
    // Weekly on Thursdays; 12 L came on Thursday 12.11; on Saturday 14.11 about 12 x (1 - 2/7) = 8.5 L is left.
    const h = [delivery("2026-11-12", "C1", 12, 1, "L"), delivery("2026-11-05", "C1", 12, 1, "L"), delivery("2026-10-29", "C1", 12, 1, "L")];
    expect(stockFromRecords(h, [line], "2026-11-14")).toEqual([{ lineId: "l1", amount: 8.5, unit: "L", deliveredOn: "2026-11-12", productId: "C1" }]);
  });

  it("never counts a part, a delivery used up by now, another unit or another kind", () => {
    const h = [delivery("2026-11-12", "C1", 4, 1, "L"), delivery("2026-11-05", "C1", 4, 1, "L")];
    expect(stockFromRecords(h, [line], "2026-11-14")).toEqual([]); // about 2.8 L left: less than the 4 L needed
    expect(stockFromRecords([delivery("2026-11-01", "C1", 40, 1, "L")], [line], "2026-11-14")).toEqual([]); // a week's use is gone
    expect(stockFromRecords([delivery("2026-11-12", "C1", 40, 1, "kg")], [line], "2026-11-14")).toEqual([]);
    expect(stockFromRecords([delivery("2026-11-12", "X9", 40, 1, "L", "Valio cooking cream 1 l")], [line], "2026-11-14")).toEqual([]);
  });

  it("matches the same kind in the same product group when the product differs", () => {
    const h = [delivery("2026-11-13", "X9", 20, 1, "L", "Arla whipping cream 1 l lactose free")];
    expect(stockFromRecords(h, [line], "2026-11-14")[0]).toMatchObject({ productId: "X9", deliveredOn: "2026-11-13" });
  });
});

describe("the season", () => {
  it("knows what is in season in Finland, says when, and finds it in words in three languages", () => {
    const nov = inSeason("2026-11-20").map((x) => x.key);
    expect(nov).toEqual(expect.arrayContaining(["beetroot", "swede", "elk"]));
    expect(nov).not.toContain("strawberry");
    expect(seasonText(inSeason("2026-11-20").find((x) => x.key === "beetroot")!, "en")).toBe("Aug–Mar");
    expect(seasonalIn("Punajuurisalaatti ja lanttusose").map((x) => x.key)).toEqual(expect.arrayContaining(["beetroot", "swede"]));
    expect(langOf("Mikä on sesongissa ensi viikolla?")).toBe("fi");
    expect(langOf("What is in season next week?")).toBe("en");
  });
});
