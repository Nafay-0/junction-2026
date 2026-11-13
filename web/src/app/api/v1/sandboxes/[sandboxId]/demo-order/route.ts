import { handleApprover } from "@/server/approver-session";

/** DEMO: the big screen starts a visitor kitchen's agent on the 1,000 L milk order. Creates at most a sign-off request. */
export async function POST(req: Request, ctx: { params: Promise<{ sandboxId: string }> }) {
  void req.url;
  return handleApprover(async (rt) => {
    const { sandboxId } = await ctx.params;
    const order = await rt.sandboxes.runDemoOrder(sandboxId);
    return Response.json({ order: { orderId: order.orderId, status: order.status, approvalId: order.approval?.approvalId } }, { status: 201 });
  });
}
