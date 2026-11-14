import { showRoute } from "@/server/show/http";
import { showSpend } from "@/server/show/preflight";

/** GET: the day's spend (weeks, outside-agent runs, model dollars, partner calls) and what is left of each cap. */
export async function GET(req: Request) {
  return showRoute(req, async (rt) => Response.json({ spend: showSpend(rt) }));
}
