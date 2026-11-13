import { DockError } from "@/core/errors";
import type { PublicOrder } from "@/core/orders";
import { canRead, principalOf } from "./authz";
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

/**
 * May this caller see this sign-off (its screen, QR link and live events)? Its kitchen's approver on their signed-in
 * phone, the kitchen's own agent, the operations desk, or whoever holds the one-time link token of this approval.
 * Throws 404 for anyone else, so a stranger cannot even tell the approval exists.
 */
export async function requireApprovalReader(rt: Runtime, req: Request, approvalId: string, token?: string | null): Promise<void> {
  const c = await rt.dock.approvalContext(approvalId); // 404 for unknown approvals
  if (token && (await rt.dock.approvalTokenMatches(approvalId, token))) return;
  const who = await principalOf(req, rt);
  if (canRead(who, c.order.orgId)) return;
  throw new DockError(404, "approval_not_found", `No approval ${approvalId} for you. Open it on the approver's phone, or with the link Dock sent them.`, "data_access");
}

/** Pending approvals of one organisation, newest first. */
export async function pendingFor(rt: Runtime, orgId: string): Promise<PublicOrder[]> {
  return (await rt.dock.listOrders()).filter((o) => o.orgId === orgId && o.status === "pending_approval" && o.approval?.status === "pending").reverse();
}
