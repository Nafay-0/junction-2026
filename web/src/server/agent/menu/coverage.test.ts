import { describe, expect, it } from "vitest";
import { sanitiseDraft, type LlmMenuDraft } from "./draft";
import { MENU_NOW, menuTestDock } from "./eval/fixture-catalog";
import { outsideMenuKitchen, resolveMenuKitchen } from "./kitchens";
import { menuCatalogOf } from "./match";
import { createScenarios } from "./scenarios";
import { InMemoryPlanStore, createPlanService } from "./service";
import { changeEditsOf, groupsOf } from "./thread";

type Ing = LlmMenuDraft["dishes"][number]["ingredients"][number];
const ing = (key: string, name: string, terms: string[], amount: number, unit: "g" | "ml" | "pcs", over: Partial<Ing> = {}): Ing => ({ key, name, searchTerms: terms, role: "in the dish", perCover: { amount, unit }, yieldPct: 100, amountBasis: "a normal portion", pantry: false, form: "any", avoid: [], ...over });
const dish = (name: string, ingredients: Ing[], over: Partial<LlmMenuDraft["dishes"][number]> = {}): LlmMenuDraft["dishes"][number] => ({ name, nameFi: null, course: "main", serviceDate: null, portion: "a portion", method: "Cooked.", ingredients, ...over });
const draft = (dishes: LlmMenuDraft["dishes"], covers: number | null = 20): LlmMenuDraft => ({ isFoodOrderRequest: true, declineReason: null, covers, serviceDate: "2026-11-17", occasion: "lunch", requiredClaims: [], forbiddenAllergens: [], assumptions: [], conflicts: [], dishes });

// The café's meatballs, in the fixture catalogue's terms: no minced meat is sold here, potatoes and onion are
// fresh produce (17xxx), cream is dairy.
const MEATBALLS = draft([
  dish("Meatballs in cream sauce with mashed potatoes", [
    ing("minced_meat", "Minced meat", ["jauheliha", "minced meat"], 120, "g", { role: "main protein" }),
    ing("potato", "Potato", ["peruna", "potato"], 200, "g", { role: "the mash" }),
    ing("onion", "Onion", ["sipuli", "onion"], 20, "g"),
    ing("cooking_cream", "Lactose-free cooking cream", ["ruokakerma", "cooking cream"], 50, "ml"),
    ing("salt", "Salt", ["suola"], 2, "g", { pantry: true }),
  ]),
]);

// A pool to draw random recipes from: sold, not sold, fresh produce, dairy, fish (a rule), a staple.
const POOL: Ing[] = [
  ing("salmon_fillet", "Salmon fillet", ["lohifilee", "salmon fillet"], 90, "g", { role: "main protein" }),
  ing("potato", "Potato", ["peruna", "potato"], 150, "g"),
  ing("carrot", "Carrot", ["porkkana", "carrot"], 40, "g"),
  ing("cooking_cream", "Cooking cream", ["ruokakerma", "cooking cream"], 50, "ml"),
  ing("dill", "Fresh dill", ["tilli", "dill"], 2, "g"),
  ing("rice", "Rice", ["riisi", "rice"], 60, "g"),
  ing("unicorn_meat", "Unicorn steak", ["yksisarvinen"], 100, "g", { role: "main protein" }),
  ing("salt", "Salt", ["suola"], 2, "g", { pantry: true }),
  ing("chicken", "Chicken breast", ["broilerin rintafilee", "chicken breast"], 110, "g", { role: "main protein" }),
  ing("leek", "Leek", ["purjo", "leek"], 30, "g"),
];

function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

async function setup(drafts: Record<string, LlmMenuDraft>) {
  const { dock, valio } = await menuTestDock();
  const catalog = menuCatalogOf(valio);
  const service = createPlanService({
    dock,
    catalog,
    now: () => MENU_NOW,
    store: new InMemoryPlanStore(),
    draft: async (text) => {
      const raw = drafts[text];
      if (!raw) throw new Error(`no draft for ${text}`);
      return { draft: sanitiseDraft(raw), raw, model: "scripted:menu", ms: 1, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0, calls: [] };
    },
  });
  const kaari = (await resolveMenuKitchen("kaari", { catalog: valio }, MENU_NOW))!;
  const scenarios = createScenarios({ dock, service, catalog, profile: async () => undefined, now: () => MENU_NOW });
  return { service, kaari, scenarios };
}

describe("every ingredient has exactly one coverage, with a reason when it is not covered", () => {
  it("property: for any recipe and any kitchen rules, ingredients in equal coverages out, none uncovered without a code and words", async () => {
    const r = rng(7);
    const drafts: Record<string, LlmMenuDraft> = {};
    const cases: { text: string; groups: "all" | "dairy" | "no_fish" }[] = [];
    for (let i = 0; i < 12; i++) {
      const n = 2 + Math.floor(r() * 5);
      const picks = [...new Set(Array.from({ length: n }, () => POOL[Math.floor(r() * POOL.length)]))];
      const two = r() < 0.4 && picks.length > 2;
      drafts[`case ${i}`] = draft(two ? [dish(`Dish A ${i}`, picks.slice(0, 2)), dish(`Dish B ${i}`, picks.slice(2), { course: "side" })] : [dish(`Dish ${i}`, picks)], r() < 0.15 ? null : 20);
      cases.push({ text: `case ${i}`, groups: (["all", "dairy", "no_fish"] as const)[Math.floor(r() * 3)] });
    }
    const { service, kaari } = await setup(drafts);
    for (const c of cases) {
      const mandate = c.groups === "dairy" ? { ...kaari.mandate, allowedCategories: kaari.mandate.allowedCategories.filter((x) => /^(milk|cream|butter|yoghurt|quark|cat_10)/.test(x)) } : c.groups === "no_fish" ? { ...kaari.mandate, forbiddenAllergens: [...kaari.mandate.forbiddenAllergens, "fish"] } : kaari.mandate;
      const k = outsideMenuKitchen({ mandate, agentId: kaari.agentId, door: "menu" }, undefined, MENU_NOW);
      const { record, view } = await service.plan(k, c.text, "test");
      const ingredientsIn = record.draft.dishes.reduce((s, d) => s + d.ingredients.length, 0);
      expect(view.totals.coverage.length, c.text).toBe(ingredientsIn);
      for (const cov of view.totals.coverage) {
        expect(["ordered", "on_hand", "staple", "swapped", "not_covered"]).toContain(cov.status);
        if (cov.status === "not_covered") {
          expect(cov.code, `${c.text} ${cov.ingredient}`).toBeTruthy();
          expect(cov.words.length).toBeGreaterThan(5);
        }
      }
      expect(view.totals.complete).toBe(view.totals.coverage.every((x) => x.status !== "not_covered"));
      expect(view.totals.covered + view.totals.missing.length).toBe(view.totals.ingredients);
    }
  });
});

describe("the café's meatballs: a plan that is not the dish says so, and is not ordered as the dish", () => {
  it("names what is outside the kitchen's product groups, marks the meat as defining, and refuses the sheet until the buyer accepts part", async () => {
    const { service, kaari, scenarios } = await setup({ meatballs: MEATBALLS });
    // Kahvila Sointu's kind of mandate: dairy and dry goods only, no meat, no fresh produce.
    const cafe = outsideMenuKitchen({ mandate: { ...kaari.mandate, allowedCategories: kaari.mandate.allowedCategories.filter((x) => /^(milk|cream|butter|yoghurt|quark|cat_10|cat_22)/.test(x)) }, agentId: kaari.agentId, door: "menu" }, undefined, MENU_NOW);
    const { record, view } = await service.plan(cafe, "meatballs", "Owner");
    const cov = Object.fromEntries(view.totals.coverage.map((c) => [c.ingredient, c]));
    expect(cov["Lactose-free cooking cream"].status).toBe("ordered");
    expect(cov.Salt.status).toBe("staple");
    expect(cov.Potato).toMatchObject({ status: "not_covered", code: "outside_groups", defining: true });
    expect(cov.Potato.words).toMatch(/^Potato is in Deli, ready meals and produce: .*which your product groups do not cover \(they cover .*Dairy and cheese/);
    expect(cov["Minced meat"]).toMatchObject({ status: "not_covered", defining: true });
    expect(view.totals).toMatchObject({ complete: false, definingMissing: true, ingredients: 5 });
    expect(view.totals.blockers[0]).toMatch(/^Only \d of 5 ingredients can be bought, and what the dish is made of is not among them: not covered /);
    expect(view.totals.canQuote).toBe(false);
    // Not put up as the dish; the refusal carries every missing ingredient with its code.
    await expect(scenarios.sheetOf(cafe, record.planId, [], { by: "Owner" })).rejects.toMatchObject({ code: "plan_incomplete", details: { definingMissing: true } });
    // The buyer's own "order just those": then the sheet holds exactly what can be bought.
    await service.edit(cafe, record.planId, [{ op: "acceptPartial" }], "Owner");
    const sheet = await scenarios.sheetOf(cafe, record.planId, [], { by: "Owner" });
    expect(sheet.lines.map((l) => l.productId)).toEqual(["800010"]);
    // The groups the buyer sees: the total is for what is to order, and no price per cover for a dish that is not whole.
    const g = groupsOf(record, (await service.get(cafe, record.planId)).view, "en");
    expect(g.toOrder.map((x) => x.ingredient)).toEqual(["Lactose-free cooking cream"]);
    expect(g.onHand.map((x) => x.ingredient)).toEqual(["Salt"]);
    expect(g.cannotGet.map((x) => x.ingredient).sort()).toEqual(["Minced meat", "Onion", "Potato"]);
    expect(g.perCoverCents).toBeNull();
    expect(g.say).toMatch(/That is 2 of the 5 ingredients, not the whole dish\./);
  });

  it("'plan it without those' takes off what cannot be covered, said, and the plan is then complete as decided", async () => {
    const { service, kaari } = await setup({ meatballs: MEATBALLS });
    const cafe = outsideMenuKitchen({ mandate: { ...kaari.mandate, allowedCategories: kaari.mandate.allowedCategories.filter((x) => /^(milk|cream|butter|yoghurt|quark|cat_10|cat_22)/.test(x)) }, agentId: kaari.agentId, door: "menu" }, undefined, MENU_NOW);
    const { record, view } = await service.plan(cafe, "meatballs", "Owner");
    const missing = view.totals.missing.map((m) => m.lineId!);
    const edits = changeEditsOf("plan it without those", record, { missing });
    expect(edits).toEqual(missing.map((lineId) => ({ op: "strike", lineId, struck: true })));
    const { view: v } = await service.edit(cafe, record.planId, edits, "Owner");
    expect(v.totals.complete).toBe(true);
    expect(v.totals.coverage.filter((c) => c.code === "struck_by_buyer").map((c) => c.ingredient).sort()).toEqual(["Minced meat", "Onion", "Potato"]);
  });

  it("a correction in words moves an ingredient between groups: 'we have potatoes', 'we're out of salt'", async () => {
    const { service, kaari } = await setup({ meatballs: MEATBALLS });
    const { record } = await service.plan(kaari, "meatballs", "chef");
    const edits = changeEditsOf("we have potatoes", record);
    expect(edits).toEqual([{ op: "onHand", lineId: "potato", onHand: expect.objectContaining({ amount: null, source: { kind: "said", words: "potatoes" } }) }]);
    const { view } = await service.edit(kaari, record.planId, edits, "chef");
    expect(groupsOf(record, view, "en").onHand.map((x) => x.ingredient)).toContain("Potato");
    const { view: v2 } = await service.edit(kaari, record.planId, changeEditsOf("we're out of salt", record), "chef");
    expect(groupsOf(record, v2, "en").onHand.map((x) => x.ingredient)).not.toContain("Salt");
  });
});
