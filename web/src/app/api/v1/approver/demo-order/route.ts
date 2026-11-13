import { DockError } from "@/core/orders";
import { currentApprover, handleApprover } from "@/server/approver-session";

/** DEMO: ask this phone's kitchen agent for the 1,000 L milk order now. It will need this approver's sign-off. */
export async function POST(req: Request) {
  return handleApprover(async (rt) => {
    const me = await currentApprover(req, rt);
    if (!me?.sandbox) throw new DockError(401, "not_joined", "This phone has not joined a demo kitchen.", "approver_identity");
    const order = await rt.sandboxes.runDemoOrder(me.sandbox.sandboxId);
    return Response.json({ order: { orderId: order.orderId, status: order.status, approvalId: order.approval?.approvalId } }, { status: 201 });
  });
}
