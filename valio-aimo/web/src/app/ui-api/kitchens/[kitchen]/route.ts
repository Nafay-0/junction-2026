import { currentApprover } from "@/server/approver-session";
import { consoleKitchen } from "@/server/authz";
import { currentAccount } from "@/server/accounts/http";
import { listConsoleKitchens } from "@/server/console-kitchens";
import { errorBody, handle } from "@/server/http";

/** GET /ui-api/kitchens/{kitchen}: who this console buys for, what its mandate allows, and the other kitchens here. */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]">) {
  return handle(async (rt) => {
    const { kitchen } = await ctx.params;
    const k = await consoleKitchen(req, rt, kitchen);
    if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
    const me = await currentApprover(req, rt);
    const signedIn = await currentAccount(req, rt);
    return Response.json({ kitchen: k.info, kitchens: await listConsoleKitchens(me?.account.orgId, signedIn && rt.accounts.view(signedIn.account)) }, { headers: { "cache-control": "no-store" } });
  });
}
