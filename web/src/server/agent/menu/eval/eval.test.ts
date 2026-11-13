import { describe, expect, it } from "vitest";
import { localNow } from "@/core/kitchen";
import { sanitiseDraft } from "../draft";
import { resolveMenuKitchen } from "../kitchens";
import { menuCatalogOf } from "../match";
import { recordedDraft, recordedFix } from "../recorded";
import { InMemoryPlanStore, createPlanService } from "../service";
import { CASES, invariants } from "./cases";
import { menuTestDock, MENU_NOW } from "./fixture-catalog";
import { RECORDINGS } from "./recorded";

/**
 * The evaluation set on recorded model outputs (Sonnet 5.5, recorded with `pnpm menu:eval --record`): the checks on
 * what the model drafted, then the whole plan through plain code on the fixture catalogue. No key, no network.
 */
describe("menu evaluation, recorded model outputs", () => {
  it("covers at least eight kinds of request, each recorded", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(8);
    for (const c of CASES) expect(RECORDINGS.some((r) => r.id === c.id), `${c.id} is recorded`).toBe(true);
  });

  for (const c of CASES) {
    const rec = RECORDINGS.find((r) => r.id === c.id);
    it.skipIf(!rec)(`${c.id}: ${c.covers}`, async () => {
      const today = localNow(new Date(rec!.now)).date;
      const draft = sanitiseDraft(rec!.raw);
      const failed = c.expect(draft, today).filter((x) => !x.ok);
      expect(failed, failed.map((f) => `${f.name}: ${f.detail}`).join("; ")).toEqual([]);

      // The same output through the whole plan, on the fixture catalogue.
      const { dock, valio } = await menuTestDock();
      const service = createPlanService({ dock, catalog: menuCatalogOf(valio), now: () => MENU_NOW, store: new InMemoryPlanStore(), draft: (text, ctx) => recordedDraft(text, ctx), fix: (req) => recordedFix(req) });
      const kitchen = (await resolveMenuKitchen(c.kitchen, { catalog: valio }, MENU_NOW))!;
      const { record } = await service.plan(kitchen, c.text, "evaluation");
      await service.settled(record.planId);
      const { view } = await service.get(kitchen, record.planId);
      expect(record.state).toBe(draft.isFoodOrderRequest ? "planned" : "declined");
      if (record.state === "planned") {
        const planFailed = [...invariants(view, draft, { forbidden: kitchen.mandate.forbiddenAllergens }), ...(c.plan?.(view, draft) ?? [])].filter((x) => !x.ok);
        expect(planFailed, planFailed.map((f) => `${f.name}: ${f.detail}`).join("; ")).toEqual([]);
      }
    });
  }
});

/** Live, opt-in: one request to the model now, the same checks. `DOCK_LIVE=1 pnpm vitest run src/server/agent/menu/eval` */
const LIVE = process.env.DOCK_LIVE === "1";
describe.skipIf(!LIVE)("menu evaluation, live model (DOCK_LIVE=1)", () => {
  it("salmon soup, fresh from the model", async () => {
    const { loadLocalEnv } = await import("../../../../../scripts/lib/agent-cli");
    loadLocalEnv();
    const { draftMenu, menuModelSpec } = await import("../draft");
    if (!menuModelSpec()) return;
    const c = CASES.find((x) => x.id === "salmon-soup")!;
    const r = await draftMenu({ text: c.text, now: MENU_NOW, context: { kitchenName: "Ravintola Kaari", kitchenKind: "lunch restaurant", rules: ["Dairy must be lactose-free"], pantry: [] } });
    const failed = c.expect(r.draft, localNow(MENU_NOW).date).filter((x) => !x.ok);
    expect(failed, failed.map((f) => `${f.name}: ${f.detail}`).join("; ")).toEqual([]);
  }, 60_000);
});
