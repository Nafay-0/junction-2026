import { describe, expect, it } from "vitest";
import type { FixtureSpec } from "@/core/catalog/test-data";
import type { HistoryEntry, KitchenProfile } from "@/core/kitchen";
import { sanitiseDraft, type LlmMenuDraft } from "./draft";
import { MENU_NOW, MENU_SCENARIOS, menuTestDock } from "./eval/fixture-catalog";
import { resolveMenuKitchen } from "./kitchens";
import { liveShortlist, packAmount } from "./plan";
import { menuCatalogOf } from "./match";
import { createScenarios } from "./scenarios";
import { InMemoryPlanStore, createPlanService } from "./service";

const COOL = ["coolTemperature"];
const AMB = ["warmTemperature"];
const kg = (n: number) => ({ netWeight: { value: n, unit: "KGM" } });
const l = (n: number) => ({ volume: { value: n, unit: "LTR" } });

/** Products the two scenarios need beyond the planner's fixture catalogue (invented, not partner data). */
const EXTRA: FixtureSpec[] = [
  { id: "810001", names: { fi: "PUNAJUURI 1KG", en: "BEETROOT 1KG" }, salesUnit: "KG", baseUnit: "KG", units: [["KG", 1]], category: "17431", freeFrom: ["AN", "AP"], labels: COOL },
  { id: "810002", names: { fi: "Tunturi ranskankerma 1 kg laktoositon", en: "Tunturi creme fraiche 1 kg lactose free" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10420", claims: ["FREE_FROM_LACTOSE"], allergens: [["AM", "CONTAINS"]], labels: COOL, each: kg(1) },
  { id: "810003", names: { fi: "Tunturi smetana 1 kg laktoositon", en: "Tunturi smetana 1 kg lactose free" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10420", claims: ["FREE_FROM_LACTOSE"], allergens: [["AM", "CONTAINS"]], labels: COOL, each: kg(1) },
  { id: "810004", names: { fi: "Liemi kasvisliemijauhe 1,5 kg", en: "Liemi vegetable bouillon powder 1,5 kg" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "21902", freeFrom: ["AN", "AP", "AM"], labels: AMB, each: kg(1.5) },
  { id: "810005", names: { fi: "Liemi kasvisliemijauhe 500 g", en: "Liemi vegetable bouillon powder 500 g" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "21902", freeFrom: ["AN", "AP", "AM"], labels: AMB, each: kg(0.5) },
  { id: "810006", names: { fi: "Meijeri voi 500 g laktoositon", en: "Meijeri butter 500 g lactose free" }, salesUnit: "ST", baseUnit: "ST", units: [["ST", 1]], category: "10501", claims: ["FREE_FROM_LACTOSE"], allergens: [["AM", "CONTAINS"]], labels: COOL, each: kg(0.5) },
];
const LIVE = {
  ...MENU_SCENARIOS,
  "810001": { price: 1.4, amount: 500, date: "2026-11-16", closingTime: "2026-11-15T17:00:00", unit: "KG" },
  // The crème fraîche is shipped from the supplier: its cut-off for Monday passed on Thursday.
  "810002": { price: 6.9, amount: 500, date: "2026-11-16", closingTime: "2026-11-12T15:00:00", unit: "ST", logisticModel: "Terminal" },
  "810003": { price: 6.5, amount: 500, date: "2026-11-16", closingTime: "2026-11-15T17:00:00", unit: "ST" },
  "810004": { price: 21.0, amount: 500, date: "2026-11-16", closingTime: "2026-11-15T17:00:00", unit: "ST" },
  "810005": { price: 8.4, amount: 500, date: "2026-11-16", closingTime: "2026-11-15T17:00:00", unit: "ST" },
  "810006": { price: 4.1, amount: 500, date: "2026-11-16", closingTime: "2026-11-15T17:00:00", unit: "ST" },
};

type Ing = LlmMenuDraft["dishes"][number]["ingredients"][number];
const ing = (key: string, name: string, terms: string[], amount: number, unit: "g" | "ml" | "pcs", over: Partial<Ing> = {}): Ing => ({ key, name, searchTerms: terms, role: "in the dish", perCover: { amount, unit }, yieldPct: 100, amountBasis: "a normal portion", pantry: false, form: "fresh", avoid: [], ...over });
const draft = (dishes: LlmMenuDraft["dishes"]): LlmMenuDraft => ({ isFoodOrderRequest: true, declineReason: null, covers: 40, serviceDate: "2026-11-16", occasion: "lunch", requiredClaims: [], forbiddenAllergens: [], assumptions: [], conflicts: [], dishes });
const dish = (name: string, ingredients: Ing[]): LlmMenuDraft["dishes"][number] => ({ name, nameFi: null, course: "main", serviceDate: null, portion: "3 dl", method: "Simmered.", ingredients });

const ROOTS = draft([
  dish("Beetroot soup", [
    ing("beetroot", "Beetroot", ["punajuuri", "beetroot"], 150, "g", { role: "the body of the soup" }),
    ing("carrot", "Carrot", ["porkkana", "carrot"], 40, "g"),
    ing("cooking_cream", "Lactose-free cooking cream", ["ruokakerma", "cooking cream"], 50, "ml", { role: "richness" }),
    ing("butter", "Butter", ["voi", "butter"], 10, "g", { role: "for frying the onions" }),
    ing("vegetable_bouillon", "Vegetable bouillon powder", ["kasvisliemijauhe", "bouillon powder"], 2, "g", { role: "seasoning", form: "dried" }),
  ]),
]);
const BOOKING = draft([
  dish("Beetroot with crème fraîche and dill", [
    ing("beetroot", "Beetroot", ["punajuuri", "beetroot"], 150, "g", { role: "the body of the dish" }),
    ing("creme_fraiche", "Lactose-free crème fraîche", ["ranskankerma", "creme fraiche"], 40, "g", { role: "tang and richness" }),
    ing("dill", "Fresh dill", ["tilli", "dill"], 2, "g", { role: "garnish on top" }),
  ]),
]);

// Kaari bought the 1 l lactose-free cooking cream every Thursday, 6 l at a time.
const creamWeeks: HistoryEntry[] = ["2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12"].map((d) => ({
  orderId: `o_${d}`,
  placedAt: `${d}T06:00:00.000Z`,
  deliveryDate: d,
  family: "cream",
  amount: 6,
  unit: "L",
  totalCents: 1590,
  lines: [{ productId: "800010", name: "Tunturi cooking cream 15 % 1 l lactose free", category: "cream", attributes: ["lactose_free"], packs: 6, packSize: 1, unit: "L", unitPriceCents: 265 }],
}));

async function setup() {
  const { dock, valio } = await menuTestDock(LIVE, EXTRA);
  const catalog = menuCatalogOf(valio);
  const service = createPlanService({
    dock,
    catalog,
    now: () => MENU_NOW,
    store: new InMemoryPlanStore(),
    draft: async (text) => {
      const raw = text.startsWith("Lunch for 40 on Monday around root vegetables") ? ROOTS : text.startsWith("Unexpected booking") ? BOOKING : undefined;
      if (!raw) throw new Error(`no draft for ${text}`);
      return { draft: sanitiseDraft(raw), raw, model: "scripted:menu", ms: 1, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0, calls: [] };
    },
    fix: async () => ({ fixes: { options: [] }, ms: 1, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0 }),
  });
  const kaari = (await resolveMenuKitchen("kaari", { catalog: valio }, MENU_NOW))!;
  const profile: KitchenProfile = { orgId: kaari.mandate.issuer.orgId, name: "Kaari", deliveryWeekdays: [1, 4], history: creamWeeks, stated: [] };
  const scenarios = createScenarios({ dock, service, catalog, profile: async () => profile, now: () => MENU_NOW });
  return { dock, service, scenarios, kaari };
}

describe("scenario 1: a menu around what is in season, buying only what is missing", () => {
  it("anchors on root vegetables from the calendar and the assortment, nets off on hand, and picks the smallest pack", async () => {
    const { scenarios, kaari, dock } = await setup();
    const r = await scenarios.seasonal(kaari, "Lunch for 40 on Monday around root vegetables. I have butter.", "Sanna Koskinen (test)");
    expect(r.anchor?.kind).toBe("root_vegetables");
    expect(r.anchor?.products.map((p) => p.productId)).toEqual(expect.arrayContaining(["810001", "800006"]));
    expect(r.dishes[0].anchorLine).toMatch(/BEETROOT/i);
    const line = (id: string) => r.lines.find((x) => x.lineId === id)!;
    // Said by the chef: not bought, and labelled so.
    expect(line("butter")).toMatchObject({ status: "struck", toBuy: null, onHand: { source: "said", estimate: false } });
    // From Kaari's own history: 6 l on Thursday, about 0.86 l a day, so about 2.57 l left by Monday: the 2 l needed are on hand.
    expect(line("cooking_cream")).toMatchObject({ status: "struck", toBuy: null, onHand: { source: "bought", estimate: true, amount: "2.571 l" } });
    expect(line("cooking_cream").onHand!.text).toMatch(/^estimate: bought 6 l on Thu 12\.11\. \(5 deliveries\), goes through about 860 ml a day, so about 2\.57 l left by Mon 16\.11\./);
    // Nothing known of beetroot: nothing assumed on hand.
    expect(line("beetroot").onHand).toBeNull();
    // 80 g of bouillon: the 500 g pack, with what is left over said, not the 1.5 kg tub.
    expect(line("vegetable_bouillon").product?.productId).toBe("810005");
    expect(line("vegetable_bouillon").leftover).toMatch(/1 × 500 g for 80 g: about 420 g left over/);
    // Every decision is in the ledger, on the plan's request.
    const steps = dock.ledger.entries({ requestId: r.requestId! }).map((e) => (e.data as { step?: string }).step);
    expect(steps).toEqual(expect.arrayContaining(["seasonal_anchor", "on_hand"]));
    const sheet = await scenarios.seasonalSheet(kaari, r.planId, "Sanna Koskinen (test)");
    expect(sheet.lines.map((x) => x.productId)).not.toContain("810006");
    expect(sheet.lines.find((x) => x.productId === "810005")?.packs).toBe(1);
  });

  it("the shortlist prices the small pack first for a small need (the 1.5 kg defect)", async () => {
    const { valio } = await menuTestDock(LIVE, EXTRA);
    const [big, small] = await valio.searchProducts({ ids: ["810004", "810005"], limit: 2 }).then((ps) => [ps.find((p) => p.id === "810004")!, ps.find((p) => p.id === "810005")!]);
    expect(packAmount(big, "kg")).toBe(1.5);
    const spec = { lineId: "b", key: "b", name: "Bouillon", ingredient: ROOTS.dishes[0].ingredients[4], uses: [{ dishId: "d", dish: "Soup", course: "main", serviceDate: null, perCover: { amount: 2, unit: "g" as const }, yieldPct: 100, basis: "", role: "seasoning" }], pantry: false };
    const cand = (product: typeof big, score: number) => ({ product, score, safety: { verdict: "ok" as const, checks: [] }, why: [] });
    const candidates = { b: { candidates: [cand(big, 1), cand(small, 0.9)], rejected: [], searched: [] } };
    expect(liveShortlist([spec], candidates, {}, { perLine: 1, max: 5 })).toEqual(["810004"]);
    expect(liveShortlist([spec], candidates, {}, { perLine: 1, max: 5, covers: 40 })).toEqual(["810005"]);
  });
});

describe("scenario 2: a booking at short notice, substitutes by the ingredient's role", () => {
  it("says what cannot arrive and why, and offers verified options ranked good, better, best with the gate's word", async () => {
    const { scenarios, kaari, dock } = await setup();
    const r = await scenarios.event(kaari, "Unexpected booking for 40 on Monday", "Sanna Koskinen (test)");
    expect(r.deliverBy).toBe("2026-11-16");
    expect(r.cannotArrive.map((x) => [x.lineId, x.arrival.code])).toEqual([["creme_fraiche", "cutoff_passed"]]);
    expect(r.cannotArrive[0].arrival.why).toMatch(/the order cut-off passed on Thu 12\.11\. at 15\.00/);
    expect(r.cannotArrive[0].role).toBe("acid");
    const opts = r.options.creme_fraiche;
    // Smetana does the same job and can come; the others failed verification and are not shown.
    expect(opts[0]).toMatchObject({ rank: "best", kind: "ingredient", title: "Smetana instead, same amount" });
    expect(opts[0].checks[0].product?.productId).toBe("810003");
    expect(opts.every((o) => o.checks.every((c) => c.arrival.ok && c.rules.ok))).toBe(true);
    expect(opts.map((o) => o.optionId)).not.toContain("creme_fraiche:creme_fraiche_sour_cream");
    expect(r.unresolved.creme_fraiche.join(" ")).toMatch(/Sour cream instead/);
    // Kaari's mandate lets the agent take a like-for-like substitute alone; another kind of product goes to a person.
    expect(opts[0].signOff).toMatchObject({ needed: expect.any(Boolean), reason: expect.any(String) });
    // Choosing it puts smetana on the sheet as the substitute for the crème fraîche, so the gate judges the swap.
    const sheet = await scenarios.sheetOf(kaari, r.planId, [{ lineId: "creme_fraiche", optionId: opts[0].optionId }], { by: "Sanna Koskinen (test)" });
    expect(sheet.lines.find((x) => x.productId === "810003")).toMatchObject({ substituteFor: "810002" });
    expect(sheet.lines.map((x) => x.productId)).toEqual(expect.arrayContaining(["810001", "800013"]));
    expect(sheet.decisions[0]).toMatchObject({ lineId: "creme_fraiche", by: "Sanna Koskinen (test)" });
    const steps = dock.ledger.entries({ requestId: r.requestId! }).map((e) => (e.data as { step?: string }).step);
    expect(steps).toEqual(expect.arrayContaining(["cannot_arrive", "substitution_options", "substitution_chosen"]));
    // And it orders through the gate like any order.
    const placed = await scenarios.order(kaari, r.planId, sheet);
    expect(["committed", "pending_approval"]).toContain(placed.order.status);
  });

  it("a day nothing can come: says so with the earliest day, and offers no recipe changes", async () => {
    const { scenarios, kaari } = await setup();
    const r = await scenarios.event(kaari, "Unexpected booking for 40 tomorrow", "test", { date: "2026-11-14" });
    expect(r.allLate).toMatchObject({ neededBy: "2026-11-14" });
    expect(r.cannotArrive.length).toBe(3);
    expect(r.cannotArrive.find((x) => x.lineId === "beetroot")?.arrival).toMatchObject({ code: "later", earliest: "2026-11-16" });
    expect(Object.keys(r.options)).toEqual([]);
  });
});
