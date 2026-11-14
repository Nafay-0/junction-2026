import { handle } from "@/server/http";
import { restMenu } from "@/server/agent/menu/rest";

/** POST /api/v1/menus/ideas { text, have?, by? }: dish ideas checked against the kitchen's product groups and rules before they are offered. */
export async function POST(req: Request) {
  return handle(async (rt) => Response.json(await restMenu(rt, req, "menu_ideas")));
}
