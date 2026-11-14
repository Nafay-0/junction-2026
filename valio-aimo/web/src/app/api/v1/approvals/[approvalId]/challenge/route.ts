import { DockError } from "@/core/orders";
import { approverOf } from "@/server/approval-api";
import { handleApprover } from "@/server/approver-session";
import { relyingParty } from "@/server/config";
import { readJson } from "@/server/http";

/**
 * A passkey prompt for one decision on one approval: { decision } -> { options } for startAuthentication().
 * The challenge is derived from the approval, the order's current digest, the decision and a fresh nonce;
 * it is single-use and expires after five minutes.
 */
export async function POST(req: Request, ctx: { params: Promise<{ approvalId: string }> }) {
  return handleApprover(async (rt) => {
    const { approvalId } = await ctx.params;
    const body = (await readJson(req)) as { decision?: unknown };
    const decision = body.decision === "decline" ? "decline" : body.decision === "approve" ? "approve" : undefined;
    if (!decision) throw new DockError(400, "invalid_request", 'Send { "decision": "approve" | "decline" }.');
    const { ctx: c } = await approverOf(rt, approvalId);
    if (c.approval.status !== "pending") throw new DockError(409, "approval_not_pending", `This sign-off was already ${c.approval.status}.`);
    const options = await rt.passkeys.approvalOptions(relyingParty(req), {
      approvalId,
      orgId: c.order.orgId,
      role: c.approval.approver.role,
      orderDigest: c.orderDigest,
      decision,
    });
    return Response.json({ options });
  });
}
