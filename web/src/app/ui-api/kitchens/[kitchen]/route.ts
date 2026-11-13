import { listConsoleKitchens, resolveKitchen } from "@/server/console-kitchens";
import { errorBody } from "@/server/http";

/** GET /ui-api/kitchens/{kitchen}: who this console buys for, what its mandate allows, and the other kitchens here. */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]">) {
  void req.url; // request-time route
  const { kitchen } = await ctx.params;
  const k = await resolveKitchen(kitchen);
  if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
  return Response.json({ kitchen: k.info, kitchens: await listConsoleKitchens() }, { headers: { "cache-control": "no-store" } });
}
