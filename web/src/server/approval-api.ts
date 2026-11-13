import type { PublicOrder } from "@/core/orders";
import { buildApprovalView, type ApprovalView } from "./approval-view";
import { currentApprover } from "./approver-session";
import { demoTapEnabled } from "./config";
import { approvalRecallFlags } from "./radar/views";
import type { Runtime } from "./runtime";

/** Who must sign an approval, and how. */
export async function approverOf(rt: Runtime, approvalId: string) {
  const ctx = await rt.dock.approvalContext(approvalId);
  const account = await rt.passkeys.store.findApprover(ctx.order.orgId, ctx.approval.approver.role);
  const hasPasskey = account ? (await rt.passkeys.store.credentialsOf(account.approverId)).length > 0 : false;
  return { ctx, account, hasPasskey };
}

/** The sign-off screen's view, plus any recall hold on the order's products (src/server/radar). */
export type ApprovalViewWithRecall = ApprovalView & { recall?: ReturnType<typeof approvalRecallFlags> };

export async function approvalViewFor(rt: Runtime, req: Request, approvalId: string): Promise<ApprovalViewWithRecall> {
  const { ctx, account, hasPasskey } = await approverOf(rt, approvalId);
  const me = await currentApprover(req, rt);
  const sandbox = account ? await rt.sandboxes.forApprover(account.approverId) : undefined;
  const recall = ctx.order.status === "pending_approval" ? approvalRecallFlags(rt, ctx.order.lines.map((l) => l.productId)) : [];
  const view = buildApprovalView(ctx, {
    signIn: !account ? "link_token" : hasPasskey ? "passkey" : "demo_tap",
    demoTapEnabled: demoTapEnabled() && account !== undefined,
    viewerIsApprover: me !== undefined && me.account.approverId === account?.approverId,
    agentName: sandbox?.agentName,
    roleLabel: sandbox?.roleLabel,
  });
  return recall.length ? { ...view, recall } : view;
}

/** Pending approvals of one organisation, newest first. */
export async function pendingFor(rt: Runtime, orgId: string): Promise<PublicOrder[]> {
  return (await rt.dock.listOrders()).filter((o) => o.orgId === orgId && o.status === "pending_approval" && o.approval?.status === "pending").reverse();
}
