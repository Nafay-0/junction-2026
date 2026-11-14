import { handle } from "@/server/http";
import { restMenu } from "@/server/agent/menu/rest";

/** POST /api/v1/menus/event { text, deliverBy?, by? }: a booking at short notice: what cannot arrive, substitutes by the ingredient's role. Buys nothing. */
export async function POST(req: Request) {
  return handle(async (rt) => Response.json(await restMenu(rt, req, "plan_event_menu")));
}
