import { handle } from "@/server/http";
import { restMenu } from "@/server/agent/menu/rest";

/** POST /api/v1/menus/dish { ideasId, dishId | planId, covers?, deliverBy?, by? }: the dish in three groups (on hand, to order, cannot get). */
export async function POST(req: Request) {
  return handle(async (rt) => Response.json(await restMenu(rt, req, "plan_dish")));
}
