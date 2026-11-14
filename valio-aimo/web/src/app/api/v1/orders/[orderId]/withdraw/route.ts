import { DockError } from "@/core/errors";
import { authenticate, handle, readBody } from "@/server/http";
import { restOrder } from "@/server/rest-step";

/**
 * POST /api/v1/orders/{orderId}/withdraw  { reason?, by? }
 * Take back an order that waits for sign-off (it stops holding the weekly budget at once and the approver's phone
 * shows it as withdrawn), or a committed one this agent placed alone, until the wholesaler's order cut-off. 409
 * take_back_needs_person when a person signed it, past_cutoff after the cut-off, order_not_pending otherwise.
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
    return Response.json(restOrder(await dock.withdrawOrder(session, orderId, body as never, { agentTakeBack: true })));
  });
}
