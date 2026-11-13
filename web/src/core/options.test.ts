import { describe, expect, it } from "vitest";
import type { LiveOffer, LiveStatus, Product } from "./catalog";
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
  it("ranks full matches best, better, good by the goal, labelling what each is best at", () => {
    const { cards } = buildOptions(input({ last: past(P.box2, 10, 4) }));
    expect(cards.map((c) => [c.optionId, c.rank, c.match, c.labels, c.lines.map((l) => `${l.packs}x${l.productId}`), c.totalCents])).toEqual([
      ["opt_1", "best", "full", ["best_price", "lowest_carbon"], ["10xT-BOX"], 12900],
      ["opt_2", "better", "full", ["same_as_last_time"], ["10xU-BOX"], 13700],
      ["opt_3", "good", "full", ["most_reliable"], ["100xT-1L"], 14900],
    ]);
    expect(cards.every((c) => c.givesUp.length === 0 && c.stockConfirmed)).toBe(true);
    const byReliability = buildOptions(input({ goal: "reliability" })).cards;
    expect(byReliability.map((c) => c.lines[0].productId)).toEqual(["T-1L", "T-BOX", "U-BOX"]);
    expect(cards[0]).toMatchObject({ deliveryDate: "2026-11-17", delivered: { amount: 100 }, leftover: { amount: 0 }, co2: { kg: 105, basis: "product_group_average" }, reliability: 0.98, signOff: [] });
    expect(cards[0].quoteLines).toEqual([{ productId: "T-BOX", quantity: 10 }]);
  });

  it("computes pros and cons from the data, relative to the other cards", () => {
    const [box, other, litre] = buildOptions(input({ last: past(P.box2, 10, 4), usual: { productId: "T-BOX", text: "Usually T-BOX: 9 of your last 10 milk orders" } })).cards;
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
    expect(split.match).toBe("full"); // nobody asked for one product: two like-for-like products deliver it all
    expect(cards.find((c) => c.labels.includes("most_reliable"))?.lines[0].productId).toBe("T-1L");
    expect(excluded).toEqual([]);
  });

  it("drops a split the mandate forbids or a substitute above the price tolerance", () => {
    const none = buildOptions(input({ amount: { amount: 1000, unit: "L" }, candidates: [P.box, P.box2, P.litre], offers: [offer(P.box), offer(P.box2), offer(P.litre)], mandate: sampleMandate(NOW, { substitution: { rule: "none", maxPriceIncreasePct: 10 } }) }));
    expect(none.cards.map((c) => c.lines[0].productId)).toEqual(["T-1L"]);
    expect(none.excluded[0]).toMatchObject({ productId: "T-BOX", reason: "only 600 L in stock, and the mandate allows no substitutes", code: "no_substitute" });
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
    expect(cards).toHaveLength(2);
    expect(cards[0].lines[0].productId).toBe("A-BOX");
    expect(cards[1].labels).toEqual([]);
    expect(cards[0].labels).toEqual(["best_price", "lowest_carbon", "most_reliable"]);
    expect(cards[0].pros).not.toContain(expect.stringMatching(/^Cheapest/));
  });

  it("respects the delivery deadline, the mandate's lead time and the weekly budget", () => {
    const late = buildOptions(input({ neededBy: "2026-11-17" }));
    expect(late.excluded).toContainEqual({ productId: "T-1_5L", reason: "Arrives Wed 18 Nov, after the Tue 17 Nov you asked for: not offered, because other options meet the whole request", code: "compromise" });
    const slow = buildOptions(input({ offers: semi.map((p) => offer(p, { deliveryDate: "2026-11-30" })), neededBy: undefined }));
    expect(slow.cards).toEqual([]);
    const broke = buildOptions(input({ spentThisWeekCents: 195_000 }));
    expect(broke.cards).toEqual([]);
    expect(broke.excluded[0].reason).toBe("€129.00 would go over the weekly budget (€50.00 left of €2,000.00 after the €1,950.00 already committed this week)");
    // Money held by an order waiting for sign-off does not remove a card: it says a person decides (F-PENDING-HOLDS-BUDGET).
    // ...when a person signs the card anyway (over the agent's own limit). Within it, the agent may not spend held money.
    const held = buildOptions(input({ spentThisWeekCents: 195_000, heldThisWeekCents: 195_000, mandate: sampleMandate(NOW, { perOrderLimitCents: 5_000 }) }));
    expect(held.cards.length).toBeGreaterThan(0);
    expect(held.excluded.filter((e) => e.code === "over_budget")).toEqual([]);
    expect(held.cards[0].signOff.join(" ")).toMatch(/held by an order waiting for sign-off/);
    const alone = buildOptions(input({ spentThisWeekCents: 195_000, heldThisWeekCents: 195_000 }));
    expect(alone.cards).toEqual([]);
    expect(alone.excluded).toContainEqual(expect.objectContaining({ code: "over_budget", reason: expect.stringMatching(/held by an order waiting for sign-off is not signed; withdraw or decide that order first/) }));
    expect(slow.excluded[0]).toMatchObject({ code: "too_late", reason: "earliest delivery Mon 30 Nov is after Sat 21 Nov, the latest the mandate allows" });
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

describe("good, better, best when the request cannot be met in full", () => {
  const status = (o: LiveOffer, problems: LiveStatus["problems"] = []): LiveStatus => ({ productId: o.productId, orderable: problems.length === 0, problems, offer: o, message: `${o.productId}: ${problems.join(", ") || "ok"}.` });

  it("treats a passed order cut-off as the reason a product cannot make the date", () => {
    const cutoff = offer(P.box, { orderBy: "2026-11-12T15:00:00+0200", cutoffPassed: true, deliveryDate: "2026-11-17" });
    const r = buildOptions(input({ candidates: [P.box, P.litre], offers: [offer(P.litre)], statuses: [status(cutoff, ["cutoff_passed"]), status(offer(P.litre))] }));
    expect(r.cards.map((c) => c.lines[0].productId)).toEqual(["T-1L"]);
    expect(r.excluded).toContainEqual({ productId: "T-BOX", code: "cutoff_passed", reason: "order cut-off Thu 12 Nov 15:00 has passed, so it cannot arrive Tue 17 Nov; the wholesaler's service names no later date yet" });
  });

  it("marks the usual product's replacement as a substitute, but not as a compromise", () => {
    const cutoff = offer(P.box, { orderBy: "2026-11-12T15:00:00+0200", cutoffPassed: true });
    const r = buildOptions(input({ candidates: [P.box, P.litre], offers: [offer(P.litre)], statuses: [status(cutoff, ["cutoff_passed"]), status(offer(P.litre))], reference: { productId: "T-BOX", name: "the box", source: "usual" } }));
    expect(r.cards[0]).toMatchObject({ match: "full", givesUp: [], quoteLines: [{ productId: "T-1L", quantity: 100, substituteFor: "T-BOX" }] });
    expect(r.cards[0].cons).toContain("Instead of your usual the box.");
    expect(r.notes[0]).toMatch(/^Your usual \(the box\) cannot do it: order cut-off Thu 12 Nov 15:00 has passed/);
  });

  it("says which part of the request each option gives up, and never calls a compromise a match", () => {
    // The buyer named T-BOX; it has 60 packs (600 L) for a 1,000 L order, and 1 L cartons arrive a day late.
    const named = { productId: "T-BOX", name: "the box", source: "named" as const };
    const r = buildOptions(input({ amount: { amount: 1000, unit: "L" }, candidates: [P.box, P.box2, P.litre], offers: [offer(P.box), offer(P.box2), offer(P.litre, { deliveryDate: "2026-11-19" })], reference: named }));
    expect(r.cards.every((c) => c.match === "compromise")).toBe(true);
    expect(r.cards[0]).toMatchObject({ rank: "best", givesUp: [{ part: "split" }], quoteLines: [{ productId: "T-BOX", quantity: 60 }, { productId: "U-BOX", quantity: 40, substituteFor: "T-BOX" }] });
    const late = r.cards.find((c) => c.lines[0].productId === "T-1L")!;
    expect(late.givesUp.map((g) => g.part)).toEqual(["delivery_date", "product", "pack_size"]);
    expect(late.quoteLines).toEqual([{ productId: "T-1L", quantity: 1000, substituteFor: "T-BOX" }]);
    expect(late.givesUp[0].text).toBe("Arrives Thu 19 Nov, after the Wed 18 Nov you asked for.");
    expect(late.givesUp[2].text).toBe("Packs of 1 L instead of 10 L.");
    expect(r.notes).toContain("Nothing meets the whole request, so every option below says what it gives up.");
  });

  it("flags unknown stock and a close cut-off on the card", () => {
    const terminal = offer(P.box, { stockKnown: false, availablePacks: 999999, orderBy: "2026-11-16T17:00:00+0200" });
    const [card] = buildOptions(input({ candidates: [P.box], offers: [terminal] })).cards;
    expect(card.stockConfirmed).toBe(false);
    expect(card.orderBy).toBe("2026-11-16T17:00:00+0200");
    expect(card.cons).toEqual(expect.arrayContaining(["Stock not confirmed: the wholesaler does not report a quantity for this product, only that it can deliver.", "Order by Mon 16 Nov 17:00: the cut-off for this date is close."]));
  });

  it("converts litres to the partner's sales units with the pack data, and will not guess an uncertain pack", () => {
    const pack = (certain: boolean): Product => ({
      ...P.box,
      id: certain ? "CASE" : "VAGUE",
      unit: certain ? "L" : "pcs",
      packSize: certain ? 20 : 2,
      salesUnit: "KI",
      lotSize: 0.01,
      packContent: { perSalesUnit: { L: 20 }, baseUnitsPerSalesUnit: 2, certain, certainMeasures: certain ? ["L"] : [], issues: certain ? [] : ["sources_disagree"], label: "2 x 10 l = 20 l per KI" },
    });
    const o = (id: string): LiveOffer => ({ productId: id, unitPriceCents: 3131, availablePacks: 100, deliveryDate: "2026-11-17" });
    const r = buildOptions(input({ amount: { amount: 1000, unit: "L" }, candidates: [pack(true), pack(false)], offers: [o("CASE"), o("VAGUE")] }));
    expect(r.cards[0].quoteLines).toEqual([{ productId: "CASE", quantity: 50 }]);
    expect(r.cards[0].delivered).toEqual({ amount: 1000, unit: "L" });
    expect(r.excluded[0]).toMatchObject({ productId: "VAGUE", code: "pack_uncertain" });
    const confirmed = buildOptions(input({ amount: { amount: 1000, unit: "L" }, candidates: [pack(false)], offers: [o("VAGUE")], estimates: ["VAGUE"] }));
    expect(confirmed.cards[0].quoteLines).toEqual([{ productId: "VAGUE", quantity: 50 }]);
    expect(confirmed.cards[0].cons).toContain("Pack count rests on an estimate of the pack content that you confirmed.");
  });
});

describe("pre-selection", () => {
  const cards = buildOptions(input()).cards;
  it("follows the stated goal", () => {
    expect(preselect(cards, "price")?.optionId).toBe("opt_1");
    expect(preselect(cards, "reliability")?.optionId).toBe("opt_3");
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
    expect(s.map((p) => p.id)).toEqual(expect.arrayContaining(["X-14", "X-01"])); // most reliable, lowest (known) carbon
    const big = shortlist([...many, { ...P.box, id: "BIG" }], [], 3, { amount: 1000, unit: "L" });
    expect(big[0].id).toBe("BIG"); // a large order prices the big packs too
    expect(shortlist(semi, [], 10)).toBe(semi);
  });
});
