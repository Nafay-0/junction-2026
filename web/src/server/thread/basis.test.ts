import { describe, expect, it } from "vitest";
import { estimateFromHistory } from "@/core/on-hand";
import type { HistoryEntry } from "@/core/kitchen";
import { basisWords, shortWhy } from "./menu";

const butter = (date: string, kg: number): HistoryEntry => ({
  orderId: `o_${date}`,
  placedAt: `${date}T06:00:00.000Z`,
  deliveryDate: date,
  family: "butter",
  amount: kg,
  unit: "kg",
  totalCents: kg * 800,
  lines: [{ productId: "butter_1", name: "Valio butter 500 g", category: "butter", attributes: [], packs: kg * 2, packSize: 0.5, unit: "kg", unitPriceCents: 400 }],
});

describe("what the kitchen has, from its own order history, said plainly", () => {
  it("takes a recent large butter purchase as on hand for a dish that needs 160 g, and says it as an estimate", () => {
    const history = [butter("2026-10-29", 10), butter("2026-11-05", 10), butter("2026-11-12", 10)];
    const est = estimateFromHistory(history, (l) => l.productId === "butter_1", { amount: 0.16, unit: "kg" }, "2026-11-17")!;
    expect(est.amount).toBeGreaterThan(0.16);
    const said = basisWords(est.text, "en");
    expect(said).toMatch(/^about \d+(,\d)? kg left from Thu 12 Nov, estimate$/);
    expect(basisWords(est.text, "fi")).toMatch(/arvio$/);
  });

  it("says why a line is not bought in a few words, the same on every card", () => {
    expect(shortWhy("outside_groups", "x", "2026-11-17", "en")).toBe("not in your product groups");
    expect(shortWhy("cannot_arrive", "x", "2026-11-17", "en")).toBe("can't arrive by Tue 17 Nov");
    expect(shortWhy("rule", "Salmon: contains lactose", null, "en")).toBe("contains lactose");
  });
});
