import { DockError } from "@/core/orders";
import { currentApprover, handleApprover } from "@/server/approver-session";
import { resolveKitchen } from "@/server/console-kitchens";
import { onsiteSession } from "@/server/ops/onsite";
import { presenterKitchenOf } from "@/server/presenter";
import { runKitchenScenario } from "@/server/sandbox-scenario";
import type { Runtime } from "@/server/runtime";

/** Which show asked for this order, and who pressed the button: the order's timeline starts here. */
function presenterEntry(rt: Runtime, order: { orderId: string; requestId: string }, summary: string, role?: string) {
  rt.dock.ledger.append({ type: "agent", actor: role ? `approver:${role}` : "dock", requestId: order.requestId, orderId: order.orderId, summary: `${summary}.`, data: { event: "presenter_order", source: "presenter" } });
}

/** DEMO: ask this phone's kitchen agent for the 1,000 L milk order now. It will need this approver's sign-off. */
export async function POST(req: Request) {
  return handleApprover(async (rt) => {
    const me = await currentApprover(req, rt);
    if (me?.sandbox) {
      const order = await rt.sandboxes.runDemoOrder(me.sandbox.sandboxId);
      presenterEntry(rt, order, `A visitor's phone (${me.account.name}) asked the sandbox kitchen's agent for the scripted demo order`, me.account.role);
      return Response.json({ order: { orderId: order.orderId, status: order.status, approvalId: order.approval?.approvalId } }, { status: 201 });
    }
    // A presenter enrolled for a built-in demo kitchen: that kitchen's own agent asks, like the visitor's does.
    const presenter = me ? presenterKitchenOf(me.account) : undefined;
    const k = presenter && (await resolveKitchen(presenter.slug));
    if (!presenter || !k) throw new DockError(401, "not_joined", "This phone has not joined a demo kitchen.", "approver_identity");
    const session = await onsiteSession(rt.dock, k, "scripted demo order");
    const order = await runKitchenScenario(rt.dock, session, { by: `${presenter.approverName} (scripted buyer)` });
    presenterEntry(rt, order, `${presenter.approverName} asked ${presenter.kitchenName}'s agent for the scripted demo order from their phone (the presenter show)`, me!.account.role);
    return Response.json({ order: { orderId: order.orderId, status: order.status, approvalId: order.approval?.approvalId } }, { status: 201 });
  });
}
