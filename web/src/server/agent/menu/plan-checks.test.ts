import { describe, expect, it } from "vitest";
import { sanitiseDraft, type LlmMenuDraft } from "./draft";
import { MENU_NOW, menuTestDock } from "./eval/fixture-catalog";
import { outsideMenuKitchen, resolveMenuKitchen } from "./kitchens";
import { menuCatalogOf } from "./match";
import { InMemoryPlanStore, createPlanService } from "./service";

type Ing = LlmMenuDraft["dishes"][number]["ingredients"][number];
const ing = (key: string, name: string, terms: string[], amount: number, unit: "g" | "ml" | "pcs", over: Partial<Ing> = {}): Ing => ({ key, name, searchTerms: terms, role: "in the dish", perCover: { amount, unit }, yieldPct: 100, amountBasis: "a normal portion", pantry: false, form: "any", avoid: [], ...over });
const dish = (name: string, ingredients: Ing[], over: Partial<LlmMenuDraft["dishes"][number]> = {}): LlmMenuDraft["dishes"][number] => ({ name, nameFi: null, course: "main", serviceDate: null, portion: "a school portion", method: "Cooked.", ingredients, ...over });
const draft = (over: Partial<LlmMenuDraft>): LlmMenuDraft => ({ isFoodOrderRequest: true, declineReason: null, covers: 120, serviceDate: "2026-11-20", occasion: "school lunch", requiredClaims: [], forbiddenAllergens: [], assumptions: [], conflicts: [], dishes: [], ...over });

const DRAFTS: [RegExp, LlmMenuDraft][] = [
  // The model wrote the fish fingers into the name and the fish away from the lines: the name alone refuses it.
  [/^kalapuikot/, draft({ dishes: [dish("Kalapuikot ja perunamuusi", [ing("potato", "Potato", ["peruna", "potato"], 150, "g"), ing("butter", "Butter", ["voi"], 8, "g")])] })],
  [/^Three main dishes/, draft({ dishes: [dish("Chicken and rice", [ing("chicken", "Chicken breast", ["broilerin rintafilee", "chicken breast"], 90, "g", { role: "main protein" }), ing("rice", "Rice", ["riisi", "rice"], 60, "g")]), dish("Salmon soup", [ing("salmon", "Salmon fillet", ["lohifilee"], 80, "g", { role: "main protein" })]), dish("Chicken with mash", [ing("chicken", "Chicken breast", ["broilerin rintafilee"], 90, "g"), ing("potato", "Potato", ["peruna"], 150, "g")])] })],
  [/^chocolate cake/, draft({ covers: 10, serviceDate: "2026-11-16", dishes: [dish("Chocolate cake", [ing("dark_chocolate", "Dark baking chocolate", ["tumma leivontasuklaa"], 20, "g"), ing("butter", "Butter", ["voi"], 15, "g"), ing("egg", "Egg", ["kananmuna"], 0.5, "pcs"), ing("cocoa", "Cocoa powder", ["kaakaojauhe"], 5, "g"), ing("baking_powder", "Baking powder", ["leivinjauhe"], 1, "g")], { course: "dessert" })] })],
];

async function setup() {
  const { dock, valio } = await menuTestDock();
  const service = createPlanService({
    dock,
    catalog: menuCatalogOf(valio),
    now: () => MENU_NOW,
    store: new InMemoryPlanStore(),
    draft: async (text) => {
      const raw = DRAFTS.find(([re]) => re.test(text))?.[1];
      if (!raw) throw new Error(`no draft for ${text}`);
      return { draft: sanitiseDraft(raw), raw, model: "scripted:menu", ms: 1, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0, calls: [] };
    },
  });
  const laakso = (await resolveMenuKitchen("laakso", { catalog: valio }, MENU_NOW))!;
  const kaari = (await resolveMenuKitchen("kaari", { catalog: valio }, MENU_NOW))!;
  // A school kitchen like Metsola: no fish, nuts, peanuts or sesame; orders at most five days ahead.
  const mandate = { ...laakso.mandate, forbiddenAllergens: [...laakso.mandate.forbiddenAllergens, "fish", "sesame"], delivery: { maxLeadDays: 5 } };
  const metsola = outsideMenuKitchen({ mandate, agentId: laakso.agentId, door: "menu" }, undefined, MENU_NOW);
  metsola.info = { ...metsola.info, name: "Metsola school kitchen" };
  return { service, metsola, kaari };
}

describe("defect 1: a dish made of what the kitchen forbids is refused with its rule, and dishes that can be made are offered", () => {
  it("fish fingers and mash in a no-fish school kitchen", async () => {
    const { service, metsola } = await setup();
    const { record, view } = await service.plan(metsola, "kalapuikot ja perunamuusi 120 oppilaalle perjantaiksi", "Food service manager");
    expect(view.totals.refusedDish).toEqual({ name: "Kalapuikot ja perunamuusi", ingredient: "kalapuikot", allergen: "fish", rule: { text: "No fish", source: "mandate" } });
    // Not planned under its name with the fish taken out: nothing of the dish is bought.
    expect(view.lines).toEqual([]);
    expect(view.totals.canQuote).toBe(false);
    expect(view.totals.blockers[0]).toBe('Kalapuikot ja perunamuusi cannot be made under the kitchen\'s rule "No fish" (mandate): its kalapuikot is fish. Instead: Chicken and rice; Chicken with mash.');
    // Instead: of the same kind, every ingredient checked against the rules; the salmon soup is not offered.
    expect(view.totals.instead.map((x) => x.name)).toEqual(["Chicken and rice", "Chicken with mash"]);
    expect(record.refused?.[0].rule.text).toBe("No fish");
  });
});

describe("defect 3: the day offered is one the rules accept, checked for every line", () => {
  it("a Friday six days ahead under a five-day lead time is planned for the latest day allowed, and a later day is refused naming the rule", async () => {
    const { service, metsola } = await setup();
    const { record, view } = await service.plan(metsola, "Three main dishes for 120 pupils", "Food service manager");
    expect(record.settings.deliverBy).toBe("2026-11-18");
    expect(record.notes.join(" ")).toMatch(/at most 5 days ahead, so the plan is delivered by Wed 18 Nov, before the service day Fri 20 Nov/);
    expect(view.totals.day.date).toBe("2026-11-18");
    expect(view.totals.day.lines.length).toBeGreaterThan(0);
    for (const l of view.totals.day.lines) expect(l.ok ? l.arrives! <= "2026-11-18" : !!l.why).toBe(true);
    await expect(service.edit(metsola, record.planId, [{ op: "deliverBy", date: "2026-11-20" }], "Food service manager")).rejects.toMatchObject({ code: "delivery_too_far", rule: "delivery_deadline" });
  });
});

describe("defect 2: a recipe is complete, and the covers scale every line", () => {
  it("a chocolate cake with no flour and no sugar gets them, visibly, and 10 to 20 portions doubles every line", async () => {
    const { service, kaari } = await setup();
    const { record, view } = await service.plan(kaari, "chocolate cake for 10", "chef");
    expect(record.added?.map((a) => a.name)).toEqual(["Wheat flour", "Sugar"]);
    expect(record.notes.join(" ")).toMatch(/Chocolate cake had no flour or a flour substitute in the draft: Wheat flour added/);
    // Every ingredient says how it is covered: ordered, on hand, a staple the kitchen keeps, or open with why.
    const cov = Object.fromEntries(view.totals.coverage.map((c) => [c.ingredient, c.basis]));
    expect(cov).toMatchObject({ "Wheat flour": "staple", Sugar: "staple" });
    expect(Object.keys(cov).sort()).toEqual(["Baking powder", "Butter", "Cocoa powder", "Dark baking chocolate", "Egg", "Sugar", "Wheat flour"]);
    const before = Object.fromEntries(view.lines.map((l) => [l.lineId, l.gross!.amount]));
    const { view: v20 } = await service.edit(kaari, record.planId, [{ op: "covers", covers: 20 }], "chef");
    for (const l of v20.lines) expect(l.gross!.amount).toBeCloseTo(before[l.lineId] * 2, 3);
  });
});
