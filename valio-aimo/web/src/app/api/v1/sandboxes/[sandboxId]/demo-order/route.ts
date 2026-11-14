import { DockError } from "@/core/errors";
import { currentApprover, handleApprover } from "@/server/approver-session";
import { currentOps } from "@/server/ops/access";

/**
 * DEMO: start a visitor kitchen's agent on the 1,000 L milk order. Creates at most a sign-off request. Only the visitor
 * themselves (their phone's session) or the operations desk's screen may start it (server/authz.ts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ sandboxId: string }> }) {
  return handleApprover(async (rt) => {
    const { sandboxId } = await ctx.params;
    const me = await currentApprover(req, rt);
    if (!currentOps(req) && me?.sandbox?.sandboxId !== sandboxId) {
      throw new DockError(me ? 403 : 401, me ? "not_your_kitchen" : "not_signed_in", "Only the visitor who joined this kitchen, or the operations desk, can start its agent.", "data_access");
    }
    const order = await rt.sandboxes.runDemoOrder(sandboxId);
    return Response.json({ order: { orderId: order.orderId, status: order.status, approvalId: order.approval?.approvalId } }, { status: 201 });
  });
}
