import { standingCutoffs } from "@/server/kitchen-portal";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/** GET /ui-api/kitchens/{kitchen}/cutoffs: order cut-offs of the standing orders' products. One live call at most, kept ten minutes. */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/cutoffs">) {
  void req.url;
  return portalRoute(req, ctx.params, async (k) => Response.json(await standingCutoffs(k), noStore));
}
