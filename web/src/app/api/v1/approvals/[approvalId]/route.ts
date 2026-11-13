import { DockError } from "@/core/orders";
import { decidingRule } from "@/core/policy";
import { errorBody, handle, readJson } from "@/server/http";

/**
 * The approver decides: { decision: "approve" | "decline", token, note? }.
 * Authenticated by the one-time token from the approval link.
 * PASSKEY SEAM: accept a WebAuthn assertion here instead of `token` (see src/core/approval.ts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ approvalId: string }> }) {
  return handle(async ({ dock }) => {
    const { approvalId } = await ctx.params;
    const body = (await readJson(req)) as { decision?: unknown; token?: unknown; note?: unknown };
    if (typeof body.token !== "string") throw new DockError(401, "approval_proof_missing", "Send the token from the approval link.", "approver_identity");
    const order = await dock.decideApproval(approvalId, {
      decision: body.decision as "approve",
      proof: { kind: "link_token", token: body.token },
      note: typeof body.note === "string" ? body.note : undefined,
    });
    if (order.status === "rejected") {
      const rule = decidingRule(order.decision);
      return Response.json({ ...errorBody("policy_rejected", order.decision.reasons.join(" "), rule?.rule), order }, { status: 409 });
    }
    return Response.json({ order });
  });
}
