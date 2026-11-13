import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { draftMenu, sanitiseDraft, type LlmMenuDraft } from "./draft";
import type { LlmFixes } from "./fixes";
import { menuTestDock, MENU_NOW } from "./eval/fixture-catalog";
import { resolveMenuKitchen } from "./kitchens";
import { menuCatalogOf } from "./match";
import { useAmount } from "./plan";
import { checkSafety } from "./safety";

const approvalProofFromLink = (link: string) => ({ kind: "link_token" as const, token: new URL(link, "http://x").searchParams.get("token")! });
import { InMemoryPlanStore, createPlanService } from "./service";

// ---------- drafts as the model writes them (hand-made for the fixture catalogue) ----------

type Ing = LlmMenuDraft["dishes"][number]["ingredients"][number];
const ing = (key: string, name: string, terms: string[], amount: number, unit: "g" | "ml" | "pcs", over: Partial<Ing> = {}): Ing => ({
  key,
  name,
  searchTerms: terms,
  role: "in the dish",
  perCover: { amount, unit },
  yieldPct: 100,
  amountBasis: "a normal portion",
  pantry: false,
  form: "fresh",
  avoid: [],
  ...over,
});
const dish = (name: string, ingredients: Ing[], over: Partial<LlmMenuDraft["dishes"][number]> = {}): LlmMenuDraft["dishes"][number] => ({ name, nameFi: null, course: "main", serviceDate: null, portion: "3.5 dl", method: "Simmered.", ingredients, ...over });
const draft = (over: Partial<LlmMenuDraft>): LlmMenuDraft => ({ isFoodOrderRequest: true, declineReason: null, covers: 300, serviceDate: "2026-11-20", occasion: "lunch", requiredClaims: [], forbiddenAllergens: [], assumptions: [], conflicts: [], dishes: [], ...over });

const SALMON_SOUP = draft({
  dishes: [
    dish("Salmon soup", [
      ing("salmon_fillet", "Salmon fillet", ["lohifilee", "salmon fillet"], 90, "g", { yieldPct: 90, role: "main protein" }),
      ing("potato", "Potato", ["peruna", "potato"], 120, "g", { yieldPct: 80 }),
      ing("carrot", "Carrot", ["porkkana", "carrot"], 30, "g", { yieldPct: 85 }),
      ing("leek", "Leek", ["purjo", "leek"], 30, "g", { yieldPct: 70 }),
      ing("cooking_cream", "Lactose-free cooking cream", ["ruokakerma", "cooking cream"], 60, "ml"),
      ing("fish_stock", "Fish stock", ["kalaliemi", "fish stock"], 5, "g", { form: "any" }),
      ing("dill", "Fresh dill", ["tilli", "dill"], 3, "g", { avoid: ["kuivattu"] }),
      ing("salt", "Salt", ["suola", "salt"], 2, "g", { pantry: true }),
    ]),
  ],
});

const FIXES: Record<string, LlmFixes> = {
  salmon_fillet: {
    options: [
      { kind: "substitute", title: "Frozen salmon fillet", effect: "Same soup; thaw overnight in the cold room.", changesDish: false, ingredient: { key: "salmon_frozen", name: "Frozen salmon fillet", searchTerms: ["lohifilee pakaste", "frozen salmon"], role: "main protein", perCover: { amount: 90, unit: "g" }, yieldPct: 95, amountBasis: "same as fresh", form: "frozen", avoid: [] }, perCover: null },
      { kind: "change_dish", title: "Chicken soup instead", effect: "A different soup.", changesDish: true, ingredient: { key: "chicken", name: "Chicken breast", searchTerms: ["broilerin rintafilee", "chicken breast"], role: "main protein", perCover: { amount: 90, unit: "g" }, yieldPct: 100, amountBasis: "same", form: "fresh", avoid: [] }, perCover: null },
    ],
  },
};

async function setup() {
  const { dock, valio, api, outbox } = await menuTestDock();
  const rt = { catalog: valio };
  const service = createPlanService({
    dock,
    catalog: menuCatalogOf(valio),
    now: () => MENU_NOW,
    store: new InMemoryPlanStore(),
    draft: async (text) => {
      const raw = DRAFTS[text];
      if (!raw) throw new Error(`no draft for ${text}`);
      return { draft: sanitiseDraft(raw), raw, model: "scripted:menu", ms: 1, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0, calls: [] };
    },
    fix: async (req) => ({ fixes: FIXES[req.lineKey] ?? { options: [] }, ms: 1, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0 }),
  });
  const kaari = (await resolveMenuKitchen("kaari", rt, MENU_NOW))!;
  const laakso = (await resolveMenuKitchen("laakso", rt, MENU_NOW))!;
  return { dock, service, kaari, laakso, api, outbox };
}

const DRAFTS: Record<string, LlmMenuDraft> = {
  "salmon soup for 300 on Friday": SALMON_SOUP,
  "school lunch": draft({
    covers: 450,
    serviceDate: "2026-11-16",
    dishes: [
      dish("Rye bread", [ing("rye_bread", "Rye bread, sliced", ["ruisleipä", "rye bread"], 40, "g", { form: "any" })], { course: "bread" }),
      dish("Berry quark", [ing("quark", "Lactose-free quark", ["rahka", "quark"], 100, "g", { form: "any" }), ing("berries", "Mixed berries, frozen", ["marjasekoitus", "mixed berries"], 40, "g", { form: "frozen" })], { course: "dessert" }),
      dish("Vegetable side", [ing("potato", "Potato", ["peruna", "potato"], 100, "g", { yieldPct: 80 }), ing("carrot", "Carrot", ["porkkana", "carrot"], 40, "g")], { course: "side" }),
    ],
  }),
  satay: draft({
    covers: 200,
    serviceDate: "2026-11-17",
    conflicts: ["Peanut butter breaks the kitchen's no-nuts rule; kept as the chef asked."],
    dishes: [dish("Peanut satay chicken", [ing("chicken", "Chicken breast", ["broilerin rintafilee", "chicken breast"], 110, "g"), ing("peanut_butter", "Peanut butter", ["maapähkinävoi", "peanut butter"], 15, "g", { form: "any" }), ing("rice", "Rice", ["riisi", "rice"], 70, "g", { form: "dried" })])],
  }),
  "book a table": draft({ isFoodOrderRequest: false, declineReason: "A table booking, not food to buy.", covers: null, serviceDate: null, dishes: [] }),
  "something warming": draft({ covers: null, dishes: SALMON_SOUP.dishes }),
};

// ---------- tests ----------

describe("safety: unknown is never safe", () => {
  const p = (allergenInfo: { declared: boolean; contains: string[]; mayContain: string[] }, extra: object = {}) =>
    ({ id: "1", name: "x", brand: "b", category: "cat_21453", categoryCode: "21453", unit: "kg", packSize: 1, attributes: [], allergens: allergenInfo.contains, certificates: [], deliveryReliability: 0, carbonKgPerUnit: 0, allergenInfo: { ...allergenInfo, freeFrom: [] }, ...extra }) as never;
  const strict = { forbiddenAllergens: [{ allergen: "nuts", source: "mandate" }], requiredClaims: [], mandateAllergens: ["nuts"] };
  const asked = { forbiddenAllergens: [{ allergen: "nuts", source: "request" }], requiredClaims: [], mandateAllergens: [] };
  it("blocks contains and may-contain", () => {
    expect(checkSafety(p({ declared: true, contains: ["nuts"], mayContain: [] }), strict).verdict).toBe("block");
    expect(checkSafety(p({ declared: true, contains: [], mayContain: ["nuts"] }), asked).verdict).toBe("block");
  });
  it("holds no data for a request's rule, blocks it under the mandate's (the gate refuses unknown)", () => {
    expect(checkSafety(p({ declared: false, contains: [], mayContain: [] }), asked).verdict).toBe("hold");
    expect(checkSafety(p({ declared: false, contains: [], mayContain: [] }), strict).verdict).toBe("block");
    expect(checkSafety(p({ declared: true, contains: [], mayContain: [] }), strict).verdict).toBe("ok");
  });
  it("reads lactose-free from the claim or the absence of milk, and lets a raw vegetable through", () => {
    const lf = { forbiddenAllergens: [], requiredClaims: [{ claim: "lactose_free", source: "kitchen" }], mandateAllergens: [] };
    expect(checkSafety(p({ declared: true, contains: ["milk"], mayContain: [] }), lf).verdict).toBe("block");
    expect(checkSafety(p({ declared: true, contains: ["milk"], mayContain: [] }, { attributes: ["lactose_free"] }), lf).verdict).toBe("ok");
    expect(checkSafety(p({ declared: false, contains: [], mayContain: [] }, { categoryCode: "17421" }), lf).verdict).toBe("ok");
    expect(checkSafety(p({ declared: false, contains: [], mayContain: [] }, { categoryCode: "21905" }), lf).verdict).toBe("hold");
  });
});

describe("the model's draft is checked by code", () => {
  it("flags impossible amounts and bad dates, and reads allergen words", () => {
    const d = sanitiseDraft(draft({ serviceDate: "Friday", forbiddenAllergens: ["tree nuts"], requiredClaims: ["dairy free"], dishes: [dish("Soup", [ing("salmon", "Salmon", ["lohi"], 3000, "g"), ing("salmon", "Salmon", ["lohi"], 90, "g")])] }));
    expect(d.serviceDate).toBeNull();
    expect(d.forbiddenAllergens).toEqual(expect.arrayContaining(["nuts", "peanuts", "milk"]));
    expect(d.corrections.join(" ")).toMatch(/not a date/);
    expect(d.corrections.join(" ")).toMatch(/beyond what one cover can use/);
    expect(d.corrections.join(" ")).toMatch(/listed twice/);
  });
  it("shows the working of every amount", () => {
    const u = { dishId: "d", dish: "Soup", course: "soup", serviceDate: null, perCover: { amount: 90, unit: "g" as const }, yieldPct: 90, basis: "", role: "" };
    expect(useAmount(u, 300)).toEqual({ gross: { amount: 30, unit: "kg" }, working: "90 g × 300 covers = 27 kg ÷ 90 % usable = 30 kg" });
  });
  it("asks the model for an outline, then every dish in parallel", async () => {
    const outline = { ...draft({}), dishes: [{ name: "Salmon soup", nameFi: "Lohikeitto", course: "soup", serviceDate: null, portion: "3.5 dl", method: "Simmered." }] };
    const detail = { ingredients: SALMON_SOUP.dishes[0].ingredients, conflicts: [] };
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (o) => {
        const text = JSON.stringify(o.prompt);
        prompts.push(text);
        const body = text.includes("ONE dish") ? detail : outline;
        return { content: [{ type: "text", text: JSON.stringify(body) }], finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 50, text: 50, reasoning: undefined } }, warnings: [] };
      },
    });
    const seen: string[] = [];
    const r = await draftMenu({ text: "Salmon soup for 300 on Friday", now: MENU_NOW, context: { kitchenName: "K", kitchenKind: "lunch", rules: [], pantry: [] }, model: { model, id: "mock:menu" }, onDish: (ings) => seen.push(...ings.map((i) => i.key)) });
    expect(r.calls.map((c) => c.step)).toEqual(["outline", "dish 1"]);
    expect(r.draft.dishes[0].ingredients.map((i) => i.key)).toContain("salmon_fillet");
    expect(seen).toContain("salmon_fillet");
    expect(prompts[0]).toContain("Today is Friday 2026-11-13");
  });
});

describe("menu to order, on the fixture catalogue", () => {
  it("plans salmon soup: amounts with their working, products in packs, cut-offs, struck staples, few live calls", async () => {
    const { service, kaari, api } = await setup();
    const { record, view } = await service.plan(kaari, "salmon soup for 300 on Friday", "chef");
    await service.settled(record.planId);
    const { view: v } = await service.get(kaari, record.planId);
    const line = (key: string) => v.lines.find((l) => l.lineId === key)!;
    expect(line("potato").working).toBe("120 g × 300 covers = 36 kg ÷ 80 % usable = 45 kg");
    expect(line("potato").chosen!.products[0]).toMatchObject({ productId: "800004", packs: 23 }); // 23 x 2 kg
    expect(line("cooking_cream").chosen!.products[0].productId).toBe("800010"); // lactose-free, never the ordinary cream
    expect(line("cooking_cream").excluded.some((e) => e.productId === "800011" && /lactose/.test(e.reason))).toBe(true);
    expect(line("dill").chosen!.products[0].productId).toBe("800013"); // fresh dill, not dried: dried takes another amount
    expect(line("salt").status).toBe("struck");
    // Fresh salmon's cut-off has passed: never silently late or swapped. The frozen fillet plays the same role and
    // arrives in time, so it is chosen, with the change on the plan for the chef to accept.
    const salmon = line("salmon_fillet");
    expect(salmon.excluded.find((e) => e.productId === "800001")!.reason).toMatch(/cut-off .*passed/);
    expect(salmon.chosen!.products[0].productId).toBe("800003");
    expect(salmon.status).toBe("needs_decision");
    expect(salmon.doubts.map((d) => d.kind)).toEqual(["different_form"]);
    expect(salmon.doubts[0].text).toMatch(/frozen, not fresh/);
    expect(v.totals.canQuote).toBe(false);
    // Live calls: batched, never more than ten products in one.
    const priceCalls = api.calls.filter((c) => c.path === "/api/price");
    expect(priceCalls.every((c) => c.body!.products.length <= 10)).toBe(true);
    expect(record.liveUse.calls).toBeLessThanOrEqual(3);
    void view;
  });

  it("quotes the whole plan once after one decision, and the gate sends it to one person", async () => {
    const { service, kaari, dock, outbox } = await setup();
    const { record } = await service.plan(kaari, "salmon soup for 300 on Friday", "chef");
    await service.settled(record.planId);
    let { view } = await service.edit(kaari, record.planId, [{ op: "accept", doubtId: "salmon_fillet:different_form:800003" }], "Sanna");
    expect(view.totals.openDoubts).toBe(0);
    ({ view } = await service.edit(kaari, record.planId, [{ op: "covers", covers: 400 }], "Sanna"));
    expect(view.totals.signOff).toMatchObject({ needed: true, approver: { name: "Sanna Koskinen" } }); // over €300
    await service.quote(kaari, record.planId, "Sanna");
    let p = (await service.get(kaari, record.planId)).record;
    expect(p.state).toBe("quoted");
    expect(p.quote!.quote.lines).toHaveLength(view.totals.products);
    expect(p.quote!.policyPreview.outcome).toBe("needs_human_approval");
    p = (await service.order(kaari, record.planId)).record;
    expect(p.order!.status).toBe("pending_approval");
    // One sign-off for the whole basket, through the existing approval.
    const msg = outbox.messages().find((m) => m.approvalId === p.order!.approval!.approvalId)!;
    await dock.decideApproval(p.order!.approval!.approvalId, { decision: "approve", proof: approvalProofFromLink(msg.link) });
    p = (await service.get(kaari, record.planId)).record;
    expect(p.order!.status).toBe("committed");
    // The ledger explains the plan line by line, with the person's decision.
    const entries = dock.ledger.entries({ requestId: p.requestId! }).map((e) => e.summary);
    expect(entries.some((s) => /^Plan line 1 of \d+, /.test(s))).toBe(true);
    expect(entries.some((s) => /Sanna decided on the plan: "Use it"/.test(s))).toBe(true);
    expect(entries.some((s) => /Not ordered: Salt/.test(s))).toBe(true);
  });

  it("when no product can come, proposes ways out by the dish's logic, checked by code, and applies one", async () => {
    const { MENU_SCENARIOS } = await import("./eval/fixture-catalog");
    const { dock, valio } = await menuTestDock({ ...MENU_SCENARIOS, "800003": { ...MENU_SCENARIOS["800003"], salesBlock: true } });
    const service = createPlanService({
      dock,
      catalog: menuCatalogOf(valio),
      now: () => MENU_NOW,
      store: new InMemoryPlanStore(),
      draft: async () => ({ draft: sanitiseDraft(SALMON_SOUP), raw: SALMON_SOUP, model: "scripted:menu", ms: 1, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0, calls: [] }),
      fix: async (req) => ({ fixes: FIXES[req.lineKey] ?? { options: [] }, ms: 1, tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, costUsd: 0 }),
    });
    const kaari = (await resolveMenuKitchen("kaari", { catalog: valio }, MENU_NOW))!;
    const { record } = await service.plan(kaari, "salmon soup", "chef");
    await service.settled(record.planId);
    let { view } = await service.get(kaari, record.planId);
    let salmon = view.lines.find((l) => l.lineId === "salmon_fillet")!;
    expect(salmon.doubts[0].kind).toBe("cannot_arrive");
    expect(salmon.fixes.map((f) => [f.title, f.check?.ok])).toEqual([
      ["Frozen salmon fillet", false], // blocked by the wholesaler: not offered, with the reason
      ["Chicken soup instead", true],
    ]);
    ({ view } = await service.edit(kaari, record.planId, [{ op: "applyFix", lineId: "salmon_fillet", fixId: "salmon_fillet:fix2" }], "Sanna"));
    salmon = view.lines.find((l) => l.lineId === "salmon_fillet")!;
    expect(salmon.replaces).toMatchObject({ name: "Salmon fillet", fixTitle: "Chicken soup instead", changesDish: true });
    expect(salmon.chosen!.products[0].productId).toBe("800021");
  });

  it("in a no-nuts school kitchen: no may-contain, no unknown data, held for a person", async () => {
    const { service, laakso } = await setup();
    const { record } = await service.plan(laakso, "school lunch", "Aino");
    await service.settled(record.planId);
    const { view } = await service.get(laakso, record.planId);
    const line = (key: string) => view.lines.find((l) => l.lineId === key)!;
    // The rye bread that may contain nuts is never offered; the one with clean declared data is.
    expect(line("rye_bread").chosen!.products[0].productId).toBe("800017");
    expect(line("rye_bread").excluded.find((e) => e.productId === "800016")!.reason).toMatch(/may contain nuts/);
    // Washed potatoes have no allergen data: the mandate's gate would refuse them, so the peeled ones with data are chosen.
    expect(line("potato").chosen!.products[0].productId).toBe("800005");
    expect(line("potato").excluded.find((e) => e.productId === "800004")!.reason).toMatch(/no allergen data/);
    for (const l of view.lines.filter((x) => x.chosen)) for (const s of l.chosen!.safety.filter((x) => x.rule.startsWith("no nuts"))) expect(s.verdict).toBe("ok");
  });

  it("holds a request that breaks the kitchen's rule: no peanut product is offered, nothing is quoted", async () => {
    const { service, laakso } = await setup();
    const { record } = await service.plan(laakso, "satay", "Aino");
    await service.settled(record.planId);
    const { view } = await service.get(laakso, record.planId);
    const pb = view.lines.find((l) => l.lineId === "peanut_butter")!;
    expect(pb.chosen).toBeUndefined();
    expect(pb.doubts.map((d) => d.kind)).toEqual(expect.arrayContaining(["rule_conflict", "no_safe_product"]));
    expect(pb.doubts.find((d) => d.kind === "no_safe_product")!.text).toMatch(/contains peanuts/);
    expect(view.totals.canQuote).toBe(false);
    await expect(service.quote(laakso, record.planId, "Aino")).rejects.toMatchObject({ code: "plan_not_ready" });
  });

  it("asks only for covers when they are missing, and computes everything once given, without the model", async () => {
    const { service, kaari } = await setup();
    const { record, view } = await service.plan(kaari, "something warming", "chef");
    expect(view.lines.every((l) => l.status === "needs_covers" || l.status === "struck")).toBe(true);
    expect(view.totals.blockers[0]).toMatch(/covers/);
    const { view: v } = await service.edit(kaari, record.planId, [{ op: "covers", covers: 100 }], "chef");
    expect(v.lines.find((l) => l.lineId === "potato")!.working).toBe("120 g × 100 covers = 12 kg ÷ 80 % usable = 15 kg");
  });

  it("declines what is not a food order, without a live call", async () => {
    const { service, kaari, api } = await setup();
    const { record } = await service.plan(kaari, "book a table", "chef");
    expect(record.state).toBe("declined");
    expect(api.calls).toHaveLength(0);
  });
});
