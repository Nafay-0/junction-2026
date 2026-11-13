import { getRuntime } from "@/server/runtime";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { kitchenNotices } from "@/server/radar/views";

/** GET /ui-api/radar/kitchens/{kitchen}: recall notices about what this kitchen ordered, is ordering or regularly orders. */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/radar/kitchens/[kitchen]">) {
  void req.url; // request-time route
  return portalRoute(ctx.params, async (k) => {
    const notices = await kitchenNotices(await getRuntime(), { orgId: k.info.orgId, agentId: k.agentId });
    return Response.json({ notices }, noStore);
  });
}
