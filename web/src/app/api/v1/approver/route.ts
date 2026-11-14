import { DockError } from "@/core/orders";
import { pendingFor } from "@/server/approval-api";
import { dayText, eurShort, timeText } from "@/server/approval-view";
import { currentApprover, handleApprover } from "@/server/approver-session";
import { demoTapEnabled } from "@/server/config";
import { presenterKitchenOf } from "@/server/presenter";

/** The approver's home screen: who they are, what their agent may do alone, and what waits for them. */
export async function GET(req: Request) {
  return handleApprover(async (rt) => {
    const me = await currentApprover(req, rt);
    // A visitor's own kitchen, or a built-in demo kitchen a presenter enrolled for (/join/presenter).
    const s = me?.sandbox ?? (me ? presenterKitchenOf(me.account) : undefined);
    if (!s) throw new DockError(401, "not_joined", "This phone has not joined a demo kitchen. Scan the QR code to join.", "approver_identity");
    const orders = (await rt.dock.listOrders()).filter((o) => o.orgId === s.orgId).reverse();
    const pending = await pendingFor(rt, s.orgId);
    return Response.json({
      approver: { name: s.approverName, roleLabel: s.roleLabel, passkey: s.passkey },
      kitchen: { name: s.kitchenName, city: s.city },
      agent: { name: s.agentName, perOrderLimit: eurShort(s.perOrderLimitCents), weeklyBudget: eurShort(s.weeklyBudgetCents) },
      expiresAt: s.expiresAt,
      expiresAtText: timeText(s.expiresAt),
      demoTapEnabled: demoTapEnabled(),
      pending: pending.map((o) => ({ approvalId: o.approval!.approvalId, total: eurShort(o.totalCents), requestedAtText: timeText(o.approval!.requestedAt) })),
      recent: orders
        .filter((o) => o.status !== "pending_approval")
        .slice(0, 5)
        .map((o) => ({
          approvalId: o.approval?.approvalId,
          status: o.status,
          total: eurShort(o.totalCents),
          delivery: o.lines[0] ? dayText(o.lines[0].deliveryDate) : undefined,
          atText: timeText(o.updatedAt),
        })),
    });
  });
}
