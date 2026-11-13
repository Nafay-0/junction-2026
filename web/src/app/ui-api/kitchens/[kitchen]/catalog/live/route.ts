import { errorBody } from "@/server/http";
import { PORTAL_MAX_LIVE, liveCheck } from "@/server/kitchen-portal";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/**
 * POST /ui-api/kitchens/{kitchen}/catalog/live { productIds }: live price, availability and order cut-off for the
 * few products the buyer opened or added, through Dock's metered POST /api/v1/availability (in the ledger).
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/catalog/live">) {
  return portalRoute(ctx.params, async (k) => {
    const body = (await req.json().catch(() => ({}))) as { productIds?: unknown };
    const ids = Array.isArray(body.productIds) ? body.productIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 60) : [];
    if (ids.length === 0) return Response.json(errorBody("invalid_request", "Send productIds: the products to check."), { status: 400 });
    if (ids.length > PORTAL_MAX_LIVE) return Response.json(errorBody("too_many_products", `The shop checks at most ${PORTAL_MAX_LIVE} products at a time.`, "live_lookup_limit"), { status: 400 });
    return Response.json(await liveCheck(k, ids), noStore);
  });
}
