import { scanStep } from "@/server/channels/scan/door";
import { handle, readJson } from "@/server/http";

/**
 * POST /ui-api/scan/{kitchen}/step
 *   { action: "open", line, deliverBy?, source }       one reviewed line becomes a request in the intake
 *   { action: "respond" | "answer" | "choose" | "place" | "get", requestId, ... }   the next step of that request
 *   { action: "order", orderId }                        where an order stands
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/scan/[kitchen]/step">) {
  return handle(async () => {
    const { kitchen } = await ctx.params;
    return Response.json(await scanStep(kitchen, await readJson(req)), { headers: { "cache-control": "no-store" } });
  });
}
