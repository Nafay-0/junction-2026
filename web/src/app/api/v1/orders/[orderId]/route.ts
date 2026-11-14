import { authenticate, handle } from "@/server/http";
import { awaitDecision } from "@/server/lookup";
import { restOrder } from "@/server/rest-step";

/** GET /api/v1/orders/{orderId}[?wait=25]: with `wait` (seconds, at most 55), answer once a person decides an order waiting for sign-off, or when the time is up. */
export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return handle(async (rt) => {
    const { dock } = rt;
    const session = await authenticate(req, dock);
    const { orderId } = await ctx.params;
    const wait = Number(new URL(req.url).searchParams.get("wait") ?? 0) || 0;
    if (wait > 0) {
      const r = await awaitDecision(dock, session, orderId, wait, req.signal);
      return Response.json({ ...restOrder(r.order), decided: r.decided, waitedSeconds: r.waitedSeconds });
    }
    const { withDeliveryRecords } = await import("@/server/reliability/service");
    return Response.json(await withDeliveryRecords(rt, session.mandate.issuer.orgId, restOrder(await dock.getOrder(session, orderId))));
  });
}
