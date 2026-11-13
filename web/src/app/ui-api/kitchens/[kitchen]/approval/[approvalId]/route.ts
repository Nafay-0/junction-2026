import { approvalLink, qrSvg } from "@/server/approval-links";
import { publicBaseUrl, demoTapEnabled } from "@/server/config";
import { resolveKitchen } from "@/server/console-kitchens";
import { errorBody, handle } from "@/server/http";

/**
 * GET /ui-api/kitchens/{kitchen}/approval/{approvalId}: the QR code the console shows while an order waits.
 *
 *   visitor kitchens  the sign-off screen URL (no secret: approving needs the visitor's passkey)
 *   demo kitchens     their named approver is fictional and has no passkey, so the code carries the one-time
 *                     link Dock "sent to their phone". Only outside production, or with DOCK_DEMO_TAP_APPROVAL on,
 *                     because whoever scans it can sign in that person's place.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/approval/[approvalId]">) {
  return handle(async ({ dock, outbox }) => {
    const { kitchen, approvalId } = await ctx.params;
    const k = await resolveKitchen(kitchen);
    if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
    const c = await dock.approvalContext(approvalId);
    if (c.order.orgId !== k.info.orgId) return Response.json(errorBody("approval_not_found", "No such sign-off for this kitchen."), { status: 404 });
    const approver = { name: c.approval.approver.name, role: c.approval.approver.role };

    if (k.info.kind === "visitor") {
      const link = await approvalLink(approvalId, req);
      return Response.json({ mode: "passkey", approver, status: c.approval.status, url: link.url, qrSvg: link.qrSvg });
    }
    const msg = outbox.messages().find((m) => m.approvalId === approvalId);
    const allowed = process.env.NODE_ENV !== "production" || demoTapEnabled();
    if (msg && allowed) {
      const url = `${publicBaseUrl(req)}${msg.link}`;
      return Response.json({ mode: "demo_link", approver, status: c.approval.status, url, qrSvg: await qrSvg(url) });
    }
    const link = await approvalLink(approvalId, req);
    return Response.json({ mode: "view_only", approver, status: c.approval.status, url: link.url, qrSvg: link.qrSvg });
  });
}
