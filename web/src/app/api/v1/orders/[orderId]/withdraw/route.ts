import { DockError } from "@/core/errors";
import { authenticate, handle, readBody } from "@/server/http";

/**
 * POST /api/v1/orders/{orderId}/withdraw  { reason?, by? }
 * Take back an order that waits for sign-off. It stops holding the weekly budget at once and the approver's phone
 * shows it as withdrawn. 409 order_not_pending once anyone has decided it (or its price expired).
 */
export async function POST(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const { orderId } = await ctx.params;
    const text = await readBody(req);
    let body: unknown = {};
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new DockError(400, "invalid_json", "Request body must be JSON (or empty).");
    }
    return Response.json({ order: await dock.withdrawOrder(session, orderId, body as never) });
  });
}
