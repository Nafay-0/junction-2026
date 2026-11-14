import { opsRoute } from "@/server/ops/handler";
import { opsOrderTimeline } from "@/server/ops/orders-view";

/** GET /ops-api/orders/{orderId}: the order's whole timeline as operations may read it (the kitchen's private memory named, never shown). */
export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return opsRoute(req, async (rt) => Response.json(await opsOrderTimeline(rt, (await ctx.params).orderId), { headers: { "cache-control": "no-store" } }));
}
