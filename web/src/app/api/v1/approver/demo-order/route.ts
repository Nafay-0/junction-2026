import { DockError } from "@/core/orders";
import { currentApprover, handleApprover } from "@/server/approver-session";
import { resolveKitchen } from "@/server/console-kitchens";
import { doorLog } from "@/server/ops/door";
import { suspensions } from "@/server/ops/suspensions";
import { presenterKitchenOf } from "@/server/presenter";
import { runKitchenScenario } from "@/server/sandbox-scenario";

/** DEMO: ask this phone's kitchen agent for the 1,000 L milk order now. It will need this approver's sign-off. */
export async function POST(req: Request) {
  return handleApprover(async (rt) => {
    const me = await currentApprover(req, rt);
    if (me?.sandbox) {
      const order = await rt.sandboxes.runDemoOrder(me.sandbox.sandboxId);
      return Response.json({ order: { orderId: order.orderId, status: order.status, approvalId: order.approval?.approvalId } }, { status: 201 });
    }
    // A presenter enrolled for a built-in demo kitchen: that kitchen's own agent asks, like the visitor's does.
    const presenter = me ? presenterKitchenOf(me.account) : undefined;
    const k = presenter && (await resolveKitchen(presenter.slug));
    if (!presenter || !k) throw new DockError(401, "not_joined", "This phone has not joined a demo kitchen.", "approver_identity");
    const session = await rt.dock.authenticate(k.mandateToken, k.agentId);
    const call = { via: "onsite" as const, transport: "direct" as const, path: "scripted demo order" };
    const record = { at: new Date().toISOString(), agentId: session.agentId, orgId: session.mandate.issuer.orgId, orgName: session.mandate.issuer.name, ...call };
    try {
      suspensions(rt.dock).enforce(session, call);
    } catch (err) {
      if (err instanceof DockError) doorLog(rt.dock).record({ ...record, ok: false, code: err.code, rule: err.rule });
      throw err;
    }
    doorLog(rt.dock).record({ ...record, ok: true }, session.mandate);
    const order = await runKitchenScenario(rt.dock, session, { by: `${presenter.approverName} (scripted buyer)` });
    return Response.json({ order: { orderId: order.orderId, status: order.status, approvalId: order.approval?.approvalId } }, { status: 201 });
  });
}
