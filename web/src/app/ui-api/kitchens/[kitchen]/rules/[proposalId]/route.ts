import { DockError } from "@/core/errors";
import { approvalLink } from "@/server/approval-links";
import { readJson } from "@/server/http";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { getRuntime } from "@/server/runtime";
import { rulesSignOff, threadStore } from "@/server/thread/engine";
import { rulesApproval } from "@/server/thread/rules";

/**
 * GET /ui-api/kitchens/{kitchen}/rules/{proposalId}: where a change that waits for the approver can be signed: the
 * sign-off screen's address and QR code for their phone (/approve/rch_..., no secret in it: signing needs their
 * passkey), and whether the signer has a signing device yet ("no_device": the kitchen adds one first).
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/rules/[proposalId]">) {
  return portalRoute(req, ctx.params, async (k) => {
    const { proposalId } = await ctx.params;
    const thread = (await threadStore()).get(k.info.slug, k.info.orgId);
    const a = rulesApproval({ thread, k }, proposalId);
    if (!a) throw new DockError(409, "rules_change_not_waiting", "That change is not waiting for a sign-off.");
    const rt = await getRuntime();
    const signer = await rt.passkeys.store.findApprover(a.orgId, a.approval.approver.role);
    const devices = signer ? (await rt.passkeys.store.credentialsOf(signer.approverId)).length : 0;
    const link = await approvalLink(a.approval.approvalId, req);
    return Response.json({ approvalId: a.approval.approvalId, approver: { name: a.approval.approver.name, role: a.approval.approver.role }, mode: devices ? "passkey" : "no_device", url: link.url, qrSvg: link.qrSvg }, noStore);
  });
}

/**
 * POST /ui-api/kitchens/{kitchen}/rules/{proposalId} { proof: { kind: "webauthn", response } }: the named approver's
 * passkey signature over a change that widens what the agent may do, made in this browser. Verified by the same
 * verifier as an order's sign-off (single-use challenge, this approver's credential, this exact change); only then is
 * the change signed.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/rules/[proposalId]">) {
  return portalRoute(req, ctx.params, async (k) => {
    const { proposalId } = await ctx.params;
    const body = (await readJson(req)) as { proof?: unknown };
    const r = await rulesSignOff(k, proposalId, body.proof);
    return Response.json(r, noStore);
  });
}
