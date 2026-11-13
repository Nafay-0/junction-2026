import { currentApprover } from "@/server/approver-session";
import { consoleKitchen } from "@/server/authz";
import { listConsoleKitchens } from "@/server/console-kitchens";
import { errorBody, handle } from "@/server/http";

/** GET /ui-api/kitchens/{kitchen}: who this console buys for, what its mandate allows, and the other kitchens here. */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]">) {
  return handle(async (rt) => {
    const { kitchen } = await ctx.params;
    const k = await consoleKitchen(req, rt, kitchen);
    if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
    const me = await currentApprover(req, rt);
    return Response.json({ kitchen: k.info, kitchens: await listConsoleKitchens(me?.account.orgId) }, { headers: { "cache-control": "no-store" } });
  });
}
