import { handle } from "@/server/http";
import { restWatch } from "@/server/watch/rest";

/** POST /api/v1/watch/auto-renew { family, on, by }: the kitchen's explicit choice, recorded with who. Off by default. */
export async function POST(req: Request) {
  return handle(async (rt) => Response.json(await restWatch(rt, req, "set_auto_renew")));
}
