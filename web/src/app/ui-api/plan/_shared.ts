import { DockError } from "@/core/errors";
import { menuKitchen } from "@/server/agent/menu/runtime";
import { planWire } from "@/server/agent/menu/wire";
import type { PlanRecord } from "@/server/agent/menu/service";
import type { PlanView } from "@/server/agent/menu/plan";

/**
 * The menu planner's screen back end (not part of the public API): the server holds the kitchen's menu mandate and
 * acts as its menu agent, exactly as /ui-api/kitchens/** does for the buyer console. Every order still goes through
 * the gate with that mandate.
 */
export async function withKitchen(slug: string) {
  const { rt, service, kitchen } = await menuKitchen(slug);
  if (!kitchen) throw new DockError(404, "kitchen_not_found", `No menu kitchen "${slug}". Try /ui-api/plan/kaari or /ui-api/plan/laakso.`);
  const reply = ({ record, view }: { record: PlanRecord; view: PlanView }, status = 200) => Response.json(planWire(record, view, kitchen, rt.dock), { status, headers: { "cache-control": "no-store" } });
  return { rt, service, kitchen, reply };
}
