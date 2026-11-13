import { requireApprovalReader } from "@/server/approval-api";
import { approvalLink } from "@/server/approval-links";
import { handleApprover } from "@/server/approver-session";

/** URL and QR code of the sign-off screen for this approval, for other screens. No secret in it. Same readers as the screen. */
export async function GET(req: Request, ctx: { params: Promise<{ approvalId: string }> }) {
  return handleApprover(async (rt) => {
    const { approvalId } = await ctx.params;
    await requireApprovalReader(rt, req, approvalId, new URL(req.url).searchParams.get("token"));
    const c = await rt.dock.approvalContext(approvalId); // 404 for unknown approvals
    return Response.json({ approvalId, orderId: c.order.orderId, status: c.approval.status, ...(await approvalLink(approvalId, req)) });
  });
}
