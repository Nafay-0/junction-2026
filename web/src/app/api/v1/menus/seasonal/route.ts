import { handle } from "@/server/http";
import { restMenu } from "@/server/agent/menu/rest";

/** POST /api/v1/menus/seasonal { text, covers?, deliverBy?, have?, by? }: a menu around what is in season, buying only what is missing. Buys nothing. */
export async function POST(req: Request) {
  return handle(async (rt) => Response.json(await restMenu(rt, req, "plan_seasonal_menu")));
}
