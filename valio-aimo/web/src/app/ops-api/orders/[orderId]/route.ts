import { DockError } from "@/core/errors";
import { opsRead, opsRoute } from "@/server/ops/handler";
import { opsContext } from "@/server/ops/context";
import { readJson } from "@/server/http";
import { opsOrderTimeline } from "@/server/ops/orders-view";

/** GET /ops-api/orders/{orderId}: the order's whole timeline as operations may read it (the kitchen's private memory named, never shown). */
export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return opsRead(req, async (rt) => Response.json(await opsOrderTimeline(rt, (await ctx.params).orderId), { headers: { "cache-control": "no-store" } }));
}

/**
 * POST /ops-api/orders/{orderId} { decision: "confirm" | "refuse", reason? }: the wholesaler's team confirms a placed
 * order for delivery, or says it cannot be delivered (with a short reason). Staff only; once per order. The order, its
 * price and its receipt do not change: the decision is a record on top (server/fulfilment).
 */
export async function POST(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return opsRoute(req, async (rt, staff) => {
    const { orderId } = await ctx.params;
    const body = (await readJson(req)) as { decision?: unknown; reason?: unknown };
    const decision = body.decision === "confirm" ? "confirm" : body.decision === "refuse" ? "refuse" : undefined;
    if (!decision) throw new DockError(400, "invalid_request", 'Send { "decision": "confirm" | "refuse", "reason"? }.');
    const order = (await opsContext(rt)).orderById.get(orderId);
    if (!order) throw new DockError(404, "order_not_found", `No order ${orderId} on this server.`);
    const { decideFulfilment } = await import("@/server/fulfilment/service");
    const f = await decideFulfilment(rt, order, { decision, by: staff.name, ...(typeof body.reason === "string" ? { reason: body.reason } : {}) });
    return Response.json({ fulfilment: f });
  });
}
