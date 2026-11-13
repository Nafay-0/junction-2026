import { overview } from "@/server/kitchen-portal";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/** GET /ui-api/kitchens/{kitchen}/portal: the shop's overview of one kitchen (orders, requests in the buyer's words, memory, this week). No live calls. */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/portal">) {
  void req.url;
  return portalRoute(ctx.params, async (k) => Response.json(await overview(k), noStore));
}
