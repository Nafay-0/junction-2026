import { describe, expect, it } from "vitest";
import type { Product } from "./catalog";
import { addDaysIso, type HistoryEntry } from "./kitchen";
import { P, kitchen, statedPref } from "./kitchen-fixtures";
import { sampleMandate } from "./test-fixtures";
import { decideRenewal, driftOf, drifted, insidePreferences, learnPatterns, nextSlot, rankSubstitutes, renewalAmounts, shortfallOf, tradeOffOf, trendOf, type SubstituteCandidate } from "./watch";

/** Thursdays (2026-10-01 is a Thursday), one order each, `litres` of the 10 L box at `centsPerLitre`. */
function thursdays(litres: number[], centsPerLitre: number | number[] = 129, product: Product = P.box, from = "2026-10-01"): HistoryEntry[] {
  return litres.map((l, i) => {
    const date = addDaysIso(from, i * 7);
    const cpl = Array.isArray(centsPerLitre) ? centsPerLitre[i] : centsPerLitre;
    const packs = l / product.packSize;
    return { orderId: `ord_${i}`, placedAt: `${addDaysIso(date, -1)}T08:00:00.000Z`, neededBy: date, deliveryDate: date, family: product.category, amount: l, unit: product.unit, totalCents: Math.round(l * cpl), lines: [{ productId: product.id, name: product.name, category: product.category, attributes: product.attributes, packs, packSize: product.packSize, unit: product.unit, unitPriceCents: Math.round(cpl * product.packSize) }] };
  });
}

describe("learning the weekly pattern", () => {
  it("learns weekday, usual amount and unit price per family, with the weeks it rests on", () => {
    const [p] = learnPatterns(kitchen(thursdays([100, 90, 110, 100, 100, 90])));
    expect(p.family).toBe("milk");
    expect(p.slots.map((s) => s.weekday)).toEqual([4]);
    expect(p.slots[0].usualAmount).toBe(100);
    expect(p.usualPerUnitCents).toBe(129);
    expect(p.basedOn).toMatchObject({ orders: 6, from: "2026-10-01", to: "2026-11-05" });
    expect(p.basedOn.weeks).toHaveLength(6);
    expect(p.basedOn.weeks[0]).toBe("2026-09-28"); // the Monday of that week
  });

  it("needs three orders over two weeks; two weekdays become two slots", () => {
    expect(learnPatterns(kitchen(thursdays([100, 100])))).toEqual([]);
    const mondays = thursdays([50, 50, 50], 129, P.box, "2026-09-28");
    const both = learnPatterns(kitchen([...thursdays([100, 100, 100]), ...mondays]));
    expect(both[0].slots.map((s) => [s.weekday, s.usualAmount])).toEqual([
      [1, 50],
      [4, 100],
    ]);
    expect(nextSlot(both[0], "2026-11-17")).toMatchObject({ date: "2026-11-19", slot: { weekday: 4 } });
  });

  it("marks staged orders", () => {
    const [p] = learnPatterns(kitchen(thursdays([100, 100, 100, 100])), { staged: (id) => id === "ord_3" });
    expect(p.stagedPoints).toBe(1);
    expect(p.slots[0].points.at(-1)!.staged).toBe(true);
  });
});

describe("trends over several weeks", () => {
  const series = (vals: number[]) => vals.map((value, i) => ({ date: addDaysIso("2026-10-01", i * 7), value }));
  it("80, 90, 100, 110 over four weeks is a trend, from the first week", () => {
    expect(trendOf(series([100, 100, 80, 90, 100, 110]), 10)).toMatchObject({ from: 80, to: 110, pct: 37.5, points: 4, slopePerWeek: 10, r2: 1 });
  });
  it("noise around the usual is not", () => {
    expect(trendOf(series([100, 90, 110, 100, 120, 100, 90, 100, 110, 100, 100, 90]), 10)).toBeUndefined();
    expect(trendOf(series([100, 90, 100, 110]), 10)).toBeUndefined();
    expect(trendOf(series([100, 100, 100, 100]), 10)).toBeUndefined();
  });
  it("a small rise under the threshold is not, a fall is a trend down", () => {
    expect(trendOf(series([100, 101, 102, 103]), 10)).toBeUndefined();
    expect(trendOf(series([120, 110, 100, 90]), 10)).toMatchObject({ pct: -25 });
  });
});

describe("drift: portions and cost", () => {
  it("portions creeping up: figures and since when", () => {
    const [p] = learnPatterns(kitchen(thursdays([100, 100, 80, 90, 100, 110])));
    const d = driftOf(p, p.slots[0]);
    expect(d.portions).toMatchObject({ kind: "portions", direction: "up", from: 80, to: 110, pct: 37.5, since: "2026-10-15", weeks: 3 });
    expect(d.cost).toBeUndefined();
    expect(renewalAmounts(p.slots[0], d)).toEqual({ usual: 100, latest: 110 });
  });

  it("cost drifting: the unit price up over weeks", () => {
    const [p] = learnPatterns(kitchen(thursdays([100, 100, 100, 100, 100], [129, 129, 133, 137, 142])));
    const d = driftOf(p, p.slots[0]);
    expect(d.portions).toBeUndefined();
    expect(d.cost).toMatchObject({ kind: "cost", direction: "up", from: 129, to: 142, since: "2026-10-08" }); // the last week at the old price
    expect(d.cost!.pct).toBeGreaterThanOrEqual(10);
  });

  it("the same basket costing more at today's live price", () => {
    const [p] = learnPatterns(kitchen(thursdays([100, 100, 100, 100])));
    expect(driftOf(p, p.slots[0], { perUnitCents: 131 })).toEqual({}); // +1.6 %: not drift
    const d = driftOf(p, p.slots[0], { perUnitCents: 142 });
    expect(d.basket).toMatchObject({ amount: 100, usualCents: 12900, nowCents: 14200, pct: 10.1 });
    expect(drifted(d)).toBe(true);
  });

  it("a flat order with flat prices has not drifted", () => {
    const [p] = learnPatterns(kitchen(thursdays([100, 90, 110, 100, 100, 90])));
    expect(drifted(driftOf(p, p.slots[0], { perUnitCents: 129 }))).toBe(false);
  });
});

describe("renew or hold", () => {
  const base = { autoRenew: true, paused: false, drift: {}, available: true, handled: false, cutoffPassed: false } as const;
  it("auto-renew on and nothing drifted: place it", () => {
    expect(decideRenewal(base).action).toBe("place");
  });
  it("off by default: only a reminder", () => {
    expect(decideRenewal({ ...base, autoRenew: false }).action).toBe("remind");
  });
  it("drifted portions: hold and ask renew at the new amount, the usual, or skip", () => {
    const [p] = learnPatterns(kitchen(thursdays([100, 100, 80, 90, 100, 110])));
    const d = decideRenewal({ ...base, drift: driftOf(p, p.slots[0]) });
    expect(d).toMatchObject({ action: "hold", because: ["portions"], choices: ["renew_new", "usual", "skip"] });
  });
  it("cost drift or the product not coming holds too, without a new amount to offer", () => {
    expect(decideRenewal({ ...base, drift: { basket: { pct: 10 } as never } })).toMatchObject({ action: "hold", because: ["basket"], choices: ["usual", "skip"] });
    expect(decideRenewal({ ...base, available: false })).toMatchObject({ action: "hold", because: ["stock"] });
    expect(decideRenewal({ ...base, available: undefined }).action).toBe("hold");
  });
  it("nothing at all when paused, already ordered, or past the cut-off", () => {
    expect(decideRenewal({ ...base, paused: true }).action).toBe("none");
    expect(decideRenewal({ ...base, handled: true }).action).toBe("none");
    expect(decideRenewal({ ...base, cutoffPassed: true }).action).toBe("none");
  });
});

describe("substitutes: good, better, best, and who decides", () => {
  const mandate = sampleMandate(new Date("2026-11-16T08:00:00Z"), { substitution: { rule: "within_preferences", maxPriceIncreasePct: 10 }, allowedCategories: ["milk", "plant_drink"], requiredAttributes: [], forbiddenAllergens: ["nuts"] });
  const offer = (p: Product, cents: number, deliveryDate = "2026-11-19") => ({ productId: p.id, unitPriceCents: cents, availablePacks: 100, deliveryDate });
  const need = { amount: 100, date: "2026-11-19" };
  const c = (p: Product, cents: number, over: Partial<SubstituteCandidate> = {}): SubstituteCandidate => ({ product: p, offer: offer(p, cents), label: "exact", ...over });

  it("the trade-off in figures: per litre against the usual, packs, maker, fat", () => {
    const t = tradeOffOf(P.box, 129, c(P.litre, 138), need);
    expect(t).toMatchObject({ perUnitCents: 138, perUnitDiffCents: 9, perUnitDiffPct: 7, packs: 100, sameMaker: true, onTime: true, fat: null, allergensAdded: [] });
    expect(tradeOffOf(P.box, 129, c(P.whole, 159), need).fat).toEqual({ from: "fat_1_5", to: "fat_3_5" });
  });

  it("inside preferences: same kind, same allergens, within the mandate's price increase", () => {
    const t = tradeOffOf(P.box, 129, c(P.litre, 138), need);
    expect(insidePreferences(P.box, c(P.litre, 138), t, mandate)).toEqual({ inside: true, outside: [] });
  });

  it("outside: dearer than the mandate allows, another fat level, a stand-in, a new allergen, a needs-approval mandate", () => {
    const dear = c(P.litre, 160);
    expect(insidePreferences(P.box, dear, tradeOffOf(P.box, 129, dear, need), mandate).outside.join(" ")).toMatch(/24 % dearer/);
    const whole = c(P.whole, 130);
    expect(insidePreferences(P.box, whole, tradeOffOf(P.box, 129, whole, need), mandate).outside.join(" ")).toMatch(/fat 1 5/);
    const oat = c(P.oat, 120, { label: "standin" });
    const out = insidePreferences(P.box, oat, tradeOffOf(P.box, 129, oat, need), mandate).outside.join(" ");
    expect(out).toMatch(/another kind/);
    expect(out).toMatch(/contains gluten/);
    const strict = sampleMandate(new Date("2026-11-16T08:00:00Z"), { substitution: { rule: "needs_approval", maxPriceIncreasePct: 10 } });
    const one = c(P.litre, 138);
    expect(insidePreferences(P.box, one, tradeOffOf(P.box, 129, one, need), strict)).toMatchObject({ inside: false, outside: ["the mandate has a person approve every substitute"] });
    const ruled = insidePreferences(P.box, c(P.regular, 120), tradeOffOf(P.box, 129, c(P.regular, 120), need), mandate, [statedPref({ kind: "require_claim", claim: "lactose_free", family: "milk" })]);
    expect(ruled.outside.join(" ")).toMatch(/Always lactose-free/);
  });

  it("ranks those that can come by the day: inside preferences first, then closeness, then price", () => {
    const ranked = rankSubstitutes(
      P.box,
      129,
      [c(P.box, 129), c(P.whole, 130, { label: "variant" }), c(P.litre, 138), c(P.box2, 137), c(P.organic, 199, { label: "variant", offer: offer(P.organic, 199, "2026-11-23") }), c(P.oat, 120, { label: "standin" })],
      need,
      { mandate },
    );
    expect(ranked.map((r) => [r.rank, r.productId, r.insidePreferences])).toEqual([
      ["best", "T-1L", true], // same maker, 9 cents more per litre
      ["better", "U-BOX", true], // another maker, 8 cents more per litre
      ["good", "T-WHOLE", false], // another fat level: needs a person
    ]);
    expect(ranked[0].why).toMatch(/0\.09 € more per litre; 100 × 1 l; same maker/);
  });

  it("never offers what the mandate refuses outright, nor pads the list", () => {
    const nutty: Product = { ...P.litre, id: "N-1L", allergens: ["milk", "nuts"] };
    expect(rankSubstitutes(P.box, 129, [c(nutty, 130), c(P.regular, 110, { label: "other" })], need, { mandate })).toEqual([]);
  });
});

describe("when a key product cannot come", () => {
  const o = { productId: "T-BOX", unitPriceCents: 1290, availablePacks: 0, deliveryDate: "2026-11-23" };
  it("out of stock, later than the day, or past the cut-off", () => {
    expect(shortfallOf({ offer: o, problems: ["out_of_stock"], orderable: false }, "2026-11-19")).toEqual({ reason: "not_orderable", backOn: "2026-11-23" });
    expect(shortfallOf({ offer: { ...o, availablePacks: 50 }, problems: ["later_than_requested"], orderable: true }, "2026-11-19")).toEqual({ reason: "later", backOn: "2026-11-23" });
    expect(shortfallOf({ offer: { ...o, availablePacks: 50, deliveryDate: "2026-11-18" }, problems: [], orderable: true }, "2026-11-19")).toBeUndefined();
    expect(shortfallOf({ problems: ["no_price"], orderable: false }, "2026-11-19")).toEqual({ reason: "not_orderable", backOn: null });
  });
});
