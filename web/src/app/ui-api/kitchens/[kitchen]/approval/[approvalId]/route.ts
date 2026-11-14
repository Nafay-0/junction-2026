import { approvalLink } from "@/server/approval-links";
import { demoApprovalQr } from "@/server/presenter";
import { consoleKitchen } from "@/server/authz";
import { errorBody, handle } from "@/server/http";

/**
 * GET /ui-api/kitchens/{kitchen}/approval/{approvalId}: the QR code the console shows while an order waits.
 *
 *   account kitchens  the sign-off screen URL once the kitchen has a signing device ("passkey"), else "no_device":
 *                     the order waits until a passkey is added from Agent and rules
 *   visitor kitchens  the sign-off screen URL (no secret: approving needs the visitor's passkey)
 *   demo kitchens     their named approver is fictional. Once a presenter has enrolled a passkey for that role
 *                     (operations passcode, see server/presenter.ts), the code opens the sign-off screen and works
 *                     like a visitor's ("passkey"). Before that it opens the presenter enrolment ("enrol"). Outside
 *                     production, or with DOCK_DEMO_TAP_APPROVAL on, it may instead carry the one-time link Dock "sent
 *                     to their phone" ("demo_link"), because whoever scans it signs in that person's place.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/approval/[approvalId]">) {
  return handle(async (rt) => {
    const { dock } = rt;
    const { kitchen, approvalId } = await ctx.params;
    const k = await consoleKitchen(req, rt, kitchen);
    if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
    const c = await dock.approvalContext(approvalId);
    if (c.order.orgId !== k.info.orgId) return Response.json(errorBody("approval_not_found", "No such sign-off for this kitchen."), { status: 404 });
    const approver = { name: c.approval.approver.name, role: c.approval.approver.role };
    const base = { approver, status: c.approval.status, orderId: c.order.orderId };

    if (k.info.kind === "account") {
      // The kitchen's signer signs with a passkey on a signing device. With none added yet, the order waits and the
      // screen says how to add one; no link or tap stands in for the passkey.
      const signer = await rt.passkeys.store.findApprover(c.order.orgId, c.approval.approver.role);
      const devices = signer ? (await rt.passkeys.store.credentialsOf(signer.approverId)).length : 0;
      const link = await approvalLink(approvalId, req);
      if (devices === 0) return Response.json({ mode: "no_device", ...base, url: link.url, qrSvg: "" });
      return Response.json({ mode: "passkey", ...base, url: link.url, qrSvg: link.qrSvg });
    }
    if (k.info.kind === "visitor") {
      const link = await approvalLink(approvalId, req);
      return Response.json({ mode: "passkey", ...base, url: link.url, qrSvg: link.qrSvg });
    }
    return Response.json(await demoApprovalQr(rt, req, kitchen, approvalId));
  });
}
