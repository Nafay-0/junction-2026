import { decidingRule } from "@/core/policy";
import { authenticate, errorBody, handle, readJson } from "@/server/http";
import { listOrders } from "@/server/lookup";
import { restOrder } from "@/server/rest-step";

/** GET /api/v1/orders?status=pending_approval&limit=20: this organisation's orders, newest first (the MCP tool list_orders). */
export async function GET(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const p = new URL(req.url).searchParams;
    return Response.json(await listOrders(dock, session, { ...(p.get("status") ? { status: p.get("status") } : {}), ...(p.get("limit") ? { limit: Number(p.get("limit")) } : {}) }));
  });
}

/**
 * 201 committed, 202 waiting for a human sign-off, 422 refused by the gate (error names the rule). Body: `{ requestId }`
 * alone after the intake's choice or POST /api/v1/quotes (Dock places the latest quote it signed for the request), or
 * `{ requestId, quoteToken, lines }`. `replaces`: the orderId this one changes; `replaced` says what happened to it.
 */
export async function POST(req: Request) {
  return handle(async (rt) => {
    const { dock } = rt;
    const session = await authenticate(req, dock);
    const { replaced, ...order } = await dock.placeOrder(session, (await readJson(req)) as never);
    if (order.status === "rejected") {
      const rule = decidingRule(order.decision);
      return Response.json({ ...errorBody("policy_rejected", order.decision.reasons.join(" "), rule?.rule), ...restOrder(order) }, { status: 422 });
    }
    const { withDeliveryRecords } = await import("@/server/reliability/service");
    return Response.json(await withDeliveryRecords(rt, session.mandate.issuer.orgId, { ...restOrder(order), ...(replaced ? { replaced } : {}) }), { status: order.status === "committed" ? 201 : 202 });
  });
}
