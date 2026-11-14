import { DockError } from "@/core/errors";
import { menuKitchen } from "@/server/agent/menu/runtime";
import { consoleKitchen } from "@/server/authz";
import { planWire } from "@/server/agent/menu/wire";
import { catalogBrands } from "@/server/grounding";
import type { PlanRecord } from "@/server/agent/menu/service";
import type { PlanView } from "@/server/agent/menu/plan";

/**
 * The menu planner's screen back end (not part of the public API): the server holds the kitchen's menu mandate and
 * acts as its menu agent, exactly as /ui-api/kitchens/** does for the buyer console. Every order still goes through
 * the gate with that mandate.
 */
export async function withKitchen(slug: string, req: Request) {
  const { rt, service, kitchen } = await menuKitchen(slug);
  if (!kitchen) throw new DockError(404, "kitchen_not_found", `No menu kitchen "${slug}".`);
  // The same rule as the store: only the kitchen's own signed-in account (or operations) plans and orders for it.
  if (!(await consoleKitchen(req, rt, slug))) throw new DockError(404, "kitchen_not_found", `No menu kitchen "${slug}".`);
  const brands = await catalogBrands(rt.catalog, kitchen.mandate.allowedCategories); // for the grounding check of the model's words
  const reply = ({ record, view }: { record: PlanRecord; view: PlanView }, status = 200) => Response.json(planWire(record, view, kitchen, rt.dock, brands), { status, headers: { "cache-control": "no-store" } });
  return { rt, service, kitchen, reply };
}
