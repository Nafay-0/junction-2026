import { describe, expect, it } from "vitest";
import type { LiveOffer, Product } from "./catalog";
import { NOW, P, STOCK, past } from "./kitchen-fixtures";
import { buildOptions, preselect, shortlist, type OptionsInput } from "./options";
import { sampleMandate } from "./test-fixtures";
import { addDays, isoDate } from "./util";

const offer = (p: Product, over: Partial<LiveOffer> = {}): LiveOffer => ({
  productId: p.id,
  unitPriceCents: STOCK[p.id].unitPriceCents,
  availablePacks: STOCK[p.id].availablePacks,
  deliveryDate: isoDate(addDays(NOW, STOCK[p.id].leadDays)),
  ...over,
});
const semi = [P.box, P.box2, P.litre, P.bottle];
const input = (over: Partial<OptionsInput> = {}): OptionsInput => ({
  amount: { amount: 100, unit: "L" },
  candidates: semi,
  offers: semi.map((p) => offer(p)),
  mandate: sampleMandate(NOW),
  now: NOW,
  neededBy: "2026-11-18",
  spentThisWeekCents: 0,
  ...over,
});

describe("option cards", () => {
  it("labels best price, lowest carbon, most reliable and same as last time, merging labels on one product", () => {
    const { cards } = buildOptions(input({ last: past(P.box2, 10, 4) }));
    expect(cards.map((c) => [c.optionId, c.labels, c.lines.map((l) => `${l.packs}x${l.productId}`), c.totalCents])).toEqual([
      ["opt_1", ["best_price", "lowest_carbon"], ["10xT-BOX"], 12900],
      ["opt_2", ["most_reliable"], ["100xT-1L"], 14900],
      ["opt_3", ["same_as_last_time"], ["10xU-BOX"], 13700],
    ]);
    expect(cards[0]).toMatchObject({ deliveryDate: "2026-11-17", delivered: { amount: 100 }, leftover: { amount: 0 }, co2: { kg: 105, basis: "product_group_average" }, reliability: 0.98, signOff: [] });
    expect(cards[0].quoteLines).toEqual([{ productId: "T-BOX", quantity: 10 }]);
  });

  it("computes pros and cons from the data, relative to the other cards", () => {
    const [box, litre, other] = buildOptions(input({ last: past(P.box2, 10, 4), usual: { productId: "T-BOX", text: "Usually T-BOX: 9 of your last 10 milk orders" } })).cards;
    expect(box.pros).toEqual([
      "Cheapest: €8.00 less than the next option.",
      "Lowest carbon: 7 kg CO2e less than the next option (product-group average).",
      "Exact amount: 10 x 10 L.",
      "Your usual product (9 of your last 10 milk orders).",
    ]);
    expect(box.cons).toEqual([]);
    expect(litre.pros).toEqual(["Most reliable: 99 % of past deliveries in full, against 98 % for the next.", "Exact amount: 100 x 1 L."]);
    expect(litre.cons).toEqual([
      "€20.00 (15.5 %) more than the cheapest option.",
      "10 kg CO2e more than the lowest-carbon option (product-group average).",
      "100 separate packs to handle, against 10 for another option.",
    ]);
    expect(other.cons).toContain("Delivery reliability 95 %, against 99 % for the most reliable option.");
    expect(other.pros).toContain("Same product as your last order (Thu 12 Nov).");
  });

  it("names leftovers from pack sizes and later deliveries", () => {
    const { cards } = buildOptions(input({ candidates: [P.box, P.bottle], offers: [offer(P.box), offer(P.bottle, { unitPriceCents: 120 })] })); // cheapest, so it gets a card
    const bottle = cards.find((c) => c.lines[0].productId === "T-1_5L")!;
    expect(bottle.lines[0].packs).toBe(67);
    expect(bottle.leftover).toEqual({ amount: 0.5, unit: "L" });
    expect(bottle.cons).toContain("Packs of 1.5 L round it up to 100.5 L: 0.5 L more than asked.");
    expect(bottle.cons).toContain("Arrives Wed 18 Nov, 1 day after the earliest option.");
  });

  it("fills partial stock with an allowed substitute, and says it needs a sign-off", () => {
    const { cards, excluded } = buildOptions(input({ amount: { amount: 1000, unit: "L" }, candidates: [P.box, P.box2, P.litre], offers: [offer(P.box), offer(P.box2), offer(P.litre)] }));
    const split = cards[0];
    expect(split.labels).toEqual(["best_price", "lowest_carbon"]);
    expect(split.quoteLines).toEqual([{ productId: "T-BOX", quantity: 60 }, { productId: "U-BOX", quantity: 40, substituteFor: "T-BOX" }]);
    expect(split.totalCents).toBe(132200);
    expect(split.cons).toContain("Partial stock: only 600 L of T-BOX available, so 400 L comes from U-BOX as a substitute.");
    expect(split.signOff).toEqual(["Over the €1,000.00 the agent may spend alone: a person must sign off.", "Includes a substitute: the mandate requires a person to approve it."]);
    expect(cards[1].labels).toEqual(["most_reliable"]);
    expect(excluded).toEqual([]);
  });

  it("drops a split the mandate forbids or a substitute above the price tolerance", () => {
    const none = buildOptions(input({ amount: { amount: 1000, unit: "L" }, candidates: [P.box, P.box2, P.litre], offers: [offer(P.box), offer(P.box2), offer(P.litre)], mandate: sampleMandate(NOW, { substitution: { rule: "none", maxPriceIncreasePct: 10 } }) }));
    expect(none.cards.map((c) => c.lines[0].productId)).toEqual(["T-1L"]);
    expect(none.excluded[0]).toEqual({ productId: "T-BOX", reason: "only 600 L in stock, and the mandate allows no substitutes" });
    const tight = buildOptions(input({ amount: { amount: 1000, unit: "L" }, candidates: [P.box, P.litre], offers: [offer(P.box), offer(P.litre)] }));
    expect(tight.excluded[0].reason).toBe("only 600 L in stock, and no substitute within the mandate covers the rest");
  });

  it("says so when carbon or reliability data is missing, and never invents it", () => {
    const noData = { ...P.box2, carbonKgPerUnit: undefined, deliveryReliability: undefined } as unknown as Product;
    const { cards, notes } = buildOptions(input({ candidates: [P.box, noData], offers: [offer(P.box), offer(P.box2, { unitPriceCents: 1000 })] }));
    const other = cards.find((c) => c.lines[0].productId === "U-BOX")!;
    expect(other.co2).toEqual({ kg: null, basis: "missing" });
    expect(other.reliability).toBeNull();
    expect(other.cons).toEqual(expect.arrayContaining(["No carbon data for this product.", "No delivery-reliability data for this product."]));
    expect(notes).toEqual([]);
    const allMissing = buildOptions(input({ candidates: [noData], offers: [offer(P.box2)] }));
    expect(allMissing.cards[0].labels).toEqual(["best_price"]);
    expect(allMissing.notes).toEqual([
      "No carbon data for any of these products, so there is no lowest-carbon option.",
      "No delivery-reliability data for any of these products, so there is no most-reliable option.",
    ]);
  });

  it("breaks ties deterministically and does not claim a cheapest when two are equal", () => {
    const twin = { ...P.box, id: "A-BOX", name: "Twin box" };
    const { cards } = buildOptions(input({ candidates: [P.box, twin], offers: [offer(P.box), { ...offer(P.box), productId: "A-BOX" }] }));
    expect(cards).toHaveLength(1);
    expect(cards[0].lines[0].productId).toBe("A-BOX");
    expect(cards[0].labels).toEqual(["best_price", "lowest_carbon", "most_reliable"]);
    expect(cards[0].pros).not.toContain(expect.stringMatching(/^Cheapest/));
  });

  it("respects the delivery deadline, the mandate's lead time and the weekly budget", () => {
    const late = buildOptions(input({ neededBy: "2026-11-17" }));
    expect(late.excluded).toContainEqual({ productId: "T-1_5L", reason: "earliest delivery 2026-11-18 is after 2026-11-17" });
    const slow = buildOptions(input({ offers: semi.map((p) => offer(p, { deliveryDate: "2026-11-30" })), neededBy: undefined }));
    expect(slow.cards).toEqual([]);
    const broke = buildOptions(input({ spentThisWeekCents: 195_000 }));
    expect(broke.cards).toEqual([]);
    expect(broke.excluded[0].reason).toBe("€129.00 would go over the weekly budget (€50.00 left)");
  });

  it("handles a single candidate and products without an offer", () => {
    const { cards, excluded } = buildOptions(input({ offers: [offer(P.box)] }));
    expect(cards).toHaveLength(1);
    expect(cards[0].pros).toEqual(["Exact amount: 10 x 10 L."]);
    expect(excluded.map((e) => e.reason)).toEqual(["no live offer right now", "no live offer right now", "no live offer right now"]);
  });

  it("explains why 'same as last time' is not on offer", () => {
    const { notes } = buildOptions(input({ last: past(P.regular, 10, 7) }));
    expect(notes).toEqual(["Same as last time (Milk 1.5 %, 10 L box) is not possible: it does not meet this request's requirements."]);
  });
});

describe("pre-selection", () => {
  const cards = buildOptions(input()).cards;
  it("follows the stated goal", () => {
    expect(preselect(cards, "price")?.optionId).toBe("opt_1");
    expect(preselect(cards, "reliability")?.optionId).toBe("opt_2");
    expect(preselect(cards, undefined)).toBeUndefined();
  });

  it("takes lowest CO2 only within the stated tolerance of the cheapest", () => {
    const greener = { ...P.litre, carbonKgPerUnit: 0.5 };
    const c = buildOptions(input({ candidates: [P.box, greener], offers: [offer(P.box), offer(P.litre)] })).cards; // €129 vs €149: +15.5 %
    expect(preselect(c, "co2")?.optionId).toBe("opt_2");
    expect(preselect(c, "co2", 5)).toEqual({ optionId: "opt_1", reason: "The lowest-CO2 option costs more than 5 % over the cheapest, so the cheapest is pre-selected." });
    expect(preselect(c, "co2", 20)?.optionId).toBe("opt_2");
  });
});

describe("shortlist for the live call", () => {
  it("keeps the last and usual products and caps the number of products priced", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...P.litre, id: `X-${String(i).padStart(2, "0")}`, deliveryReliability: i / 20, carbonKgPerUnit: i }));
    const s = shortlist(many, ["X-07", "nope"], 6);
    expect(s).toHaveLength(6);
    expect(s[0].id).toBe("X-07");
    expect(s.map((p) => p.id)).toEqual(expect.arrayContaining(["X-14", "X-00"])); // most reliable, lowest carbon
    expect(shortlist(semi, [], 10)).toBe(semi);
  });
});
