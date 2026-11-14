import { DockError } from "@/core/errors";
import { handleApprover } from "@/server/approver-session";
import { relyingParty } from "@/server/config";
import { readJson } from "@/server/http";
import { rulesChangeOptions } from "@/server/thread/rules-signoff";

/**
 * POST /ui-api/rules-changes/{approvalId}/challenge { decision } -> { options } for startAuthentication(): a passkey
 * prompt bound to this change to the rules, the mandate it changes, the decision and a fresh single-use nonce.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/rules-changes/[approvalId]/challenge">) {
  return handleApprover(async (rt) => {
    const { approvalId } = await ctx.params;
    const body = (await readJson(req)) as { decision?: unknown };
    const decision = body.decision === "decline" ? "decline" : body.decision === "approve" ? "approve" : undefined;
    if (!decision) throw new DockError(400, "invalid_request", 'Send { "decision": "approve" | "decline" }.');
    return Response.json({ options: await rulesChangeOptions(rt, req, approvalId, decision, relyingParty(req)) }, { headers: { "cache-control": "no-store" } });
  });
}
