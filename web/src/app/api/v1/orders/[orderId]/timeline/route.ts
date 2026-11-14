import { authenticate, handle } from "@/server/http";
import { ownOrderTimeline } from "@/server/ops/orders-view";

/**
 * GET /api/v1/orders/{orderId}/timeline: the order's whole life, step by step, with who or what did each step and
 * its ledger entry, for the organisation the order belongs to (404 for anyone else). The kitchen's own store reads
 * the same timeline; operations read it with the kitchen's private memory left out.
 */
export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return handle(async (rt) => {
    const session = await authenticate(req, rt.dock);
    const order = await rt.dock.getOrder(session, (await ctx.params).orderId);
    const viewer = session.door === "mcp" || session.door === "rest" || session.door === "connector" ? "agent" : "buyer";
    return Response.json({ timeline: await ownOrderTimeline(rt, order, viewer) }, { headers: { "cache-control": "no-store" } });
  });
}
