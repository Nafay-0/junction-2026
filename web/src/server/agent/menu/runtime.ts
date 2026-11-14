import { alternativesSource } from "../../knowledge/service";
import { getRuntime } from "../../runtime";
import { draftMenu, menuModelSpec } from "./draft";
import { proposeFixes } from "./fixes";
import { resolveMenuKitchen } from "./kitchens";
import { menuCatalogOf } from "./match";
import { pickProducts } from "./pick";
import { recordedDraft, recordedFix } from "./recorded";
import { InMemoryPlanStore, createPlanService, type PlanService } from "./service";

/**
 * The menu planner wired to the server's one Dock runtime. With a model key, the model drafts; without one (or
 * with DOCK_MENU_MODEL=recorded), the recorded outputs of the evaluation set answer the requests they cover, and
 * every plan made that way says so on screen.
 */
const g = globalThis as typeof globalThis & { __dockMenu?: { service: PlanService; store: InMemoryPlanStore; key: unknown } };

export function menuMode(): "model" | "recorded" {
  return process.env.DOCK_MENU_MODEL === "recorded" || !menuModelSpec() ? "recorded" : "model";
}

export async function menuRuntime() {
  const rt = await getRuntime();
  if (!g.__dockMenu || g.__dockMenu.key !== rt) {
    const store = new InMemoryPlanStore();
    const recorded = menuMode() === "recorded";
    const service = createPlanService({
      dock: rt.dock,
      catalog: menuCatalogOf(rt.catalog),
      now: () => new Date(),
      store,
      draft: async (text, ctx, now) => (recorded ? recordedDraft(text, ctx) : draftMenu({ text, context: ctx, now })),
      fix: async (req, ctx) => (recorded ? recordedFix(req) : proposeFixes(req, ctx)),
      ...(recorded ? {} : { pick: (lines) => pickProducts(lines) }),
      // The product knowledge map's alternatives by the dish's use (real catalogue only).
      ...(rt.catalogSource.kind === "valio" && process.env.DOCK_KNOWLEDGE !== "off" ? { alternatives: alternativesSource() } : {}),
    });
    g.__dockMenu = { service, store, key: rt };
  }
  return { rt, service: g.__dockMenu.service };
}

export async function menuKitchen(slug: string) {
  const { rt, service } = await menuRuntime();
  const kitchen = await resolveMenuKitchen(slug, rt);
  return { rt, service, kitchen };
}
