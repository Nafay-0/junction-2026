import type { ApprovalProof } from "@/core/approval";
import { DockError } from "@/core/orders";
import { decidingRule } from "@/core/policy";
import { approvalViewFor, requireApprovalReader } from "@/server/approval-api";
import { handleApprover, sessionTokenOf } from "@/server/approver-session";
import { errorBody, readJson } from "@/server/http";

type Ctx = { params: Promise<{ approvalId: string }> };

/**
 * The sign-off screen's content for one approval, in plain words (no secrets). For its kitchen's approver (signed-in
 * phone), its agent, the operations desk, or ?token= from the one-time link; 404 for anyone else (server/authz.ts).
 */
export async function GET(req: Request, ctx: Ctx) {
  return handleApprover(async (rt) => {
    const { approvalId } = await ctx.params;
    await requireApprovalReader(rt, req, approvalId, new URL(req.url).searchParams.get("token"));
    return Response.json({ view: await approvalViewFor(rt, req, approvalId) });
  });
}

/**
 * The approver decides: { decision: "approve" | "decline", note?, and one of
 *   proof: { kind: "webauthn", response }   a passkey assertion for the challenge from POST ./challenge
 *   proof: { kind: "session" }              decline only, from the phone that registered (cookie)
 *   proof: { kind: "demo_tap" }             DEMO ONLY, needs DOCK_DEMO_TAP_APPROVAL=1; recorded as unverified
 *   token                                   the one-time link token (approvers without a passkey) }
 */
export async function POST(req: Request, ctx: Ctx) {
  return handleApprover(async (rt) => {
    const { approvalId } = await ctx.params;
    const body = (await readJson(req)) as { decision?: unknown; token?: unknown; note?: unknown; proof?: { kind?: unknown; response?: unknown } };
    const session = sessionTokenOf(req);
    let proof: ApprovalProof;
    const kind = body.proof?.kind;
    if (kind === "webauthn") proof = { kind: "webauthn", response: body.proof!.response as never };
    else if (kind === "session" || kind === "demo_tap") {
      if (!session) throw new DockError(401, "approval_proof_missing", "Open this on the phone you joined with.", "approver_identity");
      proof = kind === "session" ? { kind: "approver_session", sessionToken: session } : { kind: "demo_tap", sessionToken: session };
    } else if (typeof body.token === "string") proof = { kind: "link_token", token: body.token };
    else throw new DockError(401, "approval_proof_missing", "Send a passkey assertion, or the token from the approval link.", "approver_identity");

    const order = await rt.dock.decideApproval(approvalId, {
      decision: body.decision as "approve",
      proof,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
    });
    const view = await approvalViewFor(rt, req, approvalId);
    if (order.status === "rejected") {
      const rule = decidingRule(order.decision);
      return Response.json({ ...errorBody("policy_rejected", order.decision.reasons.join(" "), rule?.rule), order, view }, { status: 409 });
    }
    return Response.json({ order, view });
  });
}
