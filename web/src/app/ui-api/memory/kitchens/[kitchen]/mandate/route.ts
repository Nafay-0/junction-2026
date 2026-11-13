import { kitchenMemoryRoute } from "@/server/memory/http";

/**
 * GET /ui-api/memory/kitchens/{kitchen}/mandate
 *   Safety rules the kitchen's memory holds that its signed mandate does not: each with the change to sign, so the
 *   gate refuses an order that breaks it whichever agent sends it. Decide with POST .../kitchens/{kitchen}
 *   { action: "mandate", itemId, decision }. Re-signing is the kitchen's: Dock never holds its key.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/memory/kitchens/[kitchen]/mandate">) {
  void req.url;
  return kitchenMemoryRoute(ctx.params, async (k, memory) => ({ offers: await memory.mandateOffers(k.info.orgId, k.info.mandate) }));
}
