import { DockError } from "@/core/errors";
import { getRuntime } from "@/server/runtime";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { kitchenRulesThen } from "@/server/mariadb/kitchen-view";

/**
 * GET /ui-api/kitchens/{kitchen}/rules-then?order=ord_…: for the kitchen's own order page, the rules it was judged by
 * as they stood when it was placed, the rules now, and whether it would pass today, in the kitchen's words. Only this
 * kitchen's orders, rules and the holds on its products. When no MariaDB is attached it says so.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/rules-then">) {
  return portalRoute(req, ctx.params, async (k) => {
    const orderId = new URL(req.url).searchParams.get("order") ?? "";
    if (!/^ord_[A-Za-z0-9]{1,40}$/.test(orderId)) throw new DockError(400, "invalid_request", "Name the order: ?order=ord_…");
    const { dock } = await getRuntime();
    const session = await dock.authenticate(k.mandateToken, k.agentId);
    await dock.getOrder(session, orderId); // 404 unless it is this kitchen's own order
    return Response.json(await kitchenRulesThen(dock, session.mandate.issuer.orgId, orderId), noStore);
  });
}
