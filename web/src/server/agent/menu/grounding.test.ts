import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DOES_NOT_SAY } from "@/core/grounding";
import { groundingStats, resetGroundingStats } from "@/server/grounding";
import { resolveMenuKitchen } from "./kitchens";
import { menuCatalogOf } from "./match";
import { recordedDraft, recordedFix } from "./recorded";
import { InMemoryPlanStore, createPlanService } from "./service";
import { planWire } from "./wire";
import { CASES } from "./eval/cases";
import { menuTestDock, MENU_NOW } from "./eval/fixture-catalog";
import { RECORDINGS } from "./eval/recorded";

/** The menu planner's model-written words through the grounding check, on the recorded evaluation plans. */
async function plan(id: string) {
  const c = CASES.find((x) => x.id === id)!;
  const { dock, valio } = await menuTestDock();
  const service = createPlanService({ dock, catalog: menuCatalogOf(valio), now: () => MENU_NOW, store: new InMemoryPlanStore(), draft: (text, ctx) => recordedDraft(text, ctx), fix: (req) => recordedFix(req) });
  const kitchen = (await resolveMenuKitchen(c.kitchen, { catalog: valio }, MENU_NOW))!;
  const { record } = await service.plan(kitchen, c.text, "evaluation");
  await service.settled(record.planId);
  const { record: r, view } = await service.get(kitchen, record.planId);
  const brands = [...new Set((await valio.searchProducts({ limit: 100 })).map((p) => p.brand))];
  return { r, view, kitchen, dock, brands };
}

beforeEach(() => resetGroundingStats());

describe("menu planner text", () => {
  it("leaves every recorded plan's dishes, assumptions, warnings, roles and reasons as the model wrote them", async () => {
    for (const c of CASES.filter((x) => RECORDINGS.some((r) => r.id === x.id))) {
      const { r, view, kitchen, dock, brands } = await plan(c.id);
      const w = planWire(r, view, kitchen, dock, brands);
      expect(w.draft.assumptions, c.id).toEqual(r.draft.assumptions);
      expect(w.draft.conflicts, c.id).toEqual(r.draft.conflicts);
      expect(w.draft.dishes.map((d) => [d.name, d.portion, d.method]), c.id).toEqual(r.draft.dishes.map((d) => [d.name, d.portion, d.method]));
      expect(w.lines.map((l) => [l.roles, l.uses.map((u) => u.basis)]), c.id).toEqual(view.lines.map((l) => [l.roles, l.uses.map((u) => u.basis)]));
    }
    expect(groundingStats().surfaces.menu.fired).toBe(0);
    expect(groundingStats().surfaces.menu.checked).toBeGreaterThan(100);
  });

  it("replaces a method, assumption or warning that names a brand, price, claim or allergen the data does not back, and counts it", async () => {
    const { r, view, kitchen, dock, brands } = await plan("salmon-soup");
    r.draft.dishes[0].method = "Simmer the salmon in stock. Finish with Oatly cream, which is nut-free.";
    r.draft.assumptions = [...r.draft.assumptions, "Salmon costs about €9.99 a kilo this week."];
    r.updatedAt = new Date(Date.parse(r.updatedAt) + 1).toISOString();
    const w = planWire(r, view, kitchen, dock, [...brands, "Oatly"]);
    expect(w.draft.dishes[0].method).toBe(`Simmer the salmon in stock. ${DATA_DOES_NOT_SAY}`);
    expect(w.draft.assumptions.at(-1)).toBe(DATA_DOES_NOT_SAY);
    expect(groundingStats().surfaces.menu.fired).toBe(2);
    // Polling the same plan does not count the same fire again.
    planWire(r, view, kitchen, dock, [...brands, "Oatly"]);
    expect(groundingStats().surfaces.menu.fired).toBe(2);
  });
});
