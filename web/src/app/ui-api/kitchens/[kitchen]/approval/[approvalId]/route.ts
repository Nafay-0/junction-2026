import { approvalLink, qrSvg } from "@/server/approval-links";
import { publicBaseUrl, demoTapEnabled } from "@/server/config";
import { approverOf } from "@/server/approval-api";
import { consoleKitchen } from "@/server/authz";
import { errorBody, handle } from "@/server/http";

/**
 * GET /ui-api/kitchens/{kitchen}/approval/{approvalId}: the QR code the console shows while an order waits.
 *
 *   visitor kitchens  the sign-off screen URL (no secret: approving needs the visitor's passkey)
 *   demo kitchens     their named approver is fictional. Once a presenter has enrolled a passkey for that role
 *                     (operations passcode, see server/presenter.ts), the code opens the sign-off screen and works
 *                     like a visitor's ("passkey"). Before that it opens the presenter enrolment ("enrol"). Outside
 *                     production, or with DOCK_DEMO_TAP_APPROVAL on, it may instead carry the one-time link Dock "sent
 *                     to their phone" ("demo_link"), because whoever scans it signs in that person's place.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/approval/[approvalId]">) {
  return handle(async (rt) => {
    const { dock, outbox } = rt;
    const { kitchen, approvalId } = await ctx.params;
    const k = await consoleKitchen(req, rt, kitchen);
    if (!k) return Response.json(errorBody("kitchen_not_found", "This kitchen does not exist or its demo time is over."), { status: 404 });
    const c = await dock.approvalContext(approvalId);
    if (c.order.orgId !== k.info.orgId) return Response.json(errorBody("approval_not_found", "No such sign-off for this kitchen."), { status: 404 });
    const approver = { name: c.approval.approver.name, role: c.approval.approver.role };
    const base = { approver, status: c.approval.status, orderId: c.order.orderId };

    if (k.info.kind === "visitor") {
      const link = await approvalLink(approvalId, req);
      return Response.json({ mode: "passkey", ...base, url: link.url, qrSvg: link.qrSvg });
    }
    const { hasPasskey } = await approverOf(rt, approvalId);
    if (hasPasskey) {
      const link = await approvalLink(approvalId, req);
      return Response.json({ mode: "passkey", ...base, url: link.url, qrSvg: link.qrSvg });
    }
    const msg = outbox.messages().find((m) => m.approvalId === approvalId);
    const allowed = process.env.NODE_ENV !== "production" || demoTapEnabled();
    if (msg && allowed) {
      const url = `${publicBaseUrl(req)}${msg.link}`;
      return Response.json({ mode: "demo_link", ...base, url, qrSvg: await qrSvg(url) });
    }
    const next = `/approve/${encodeURIComponent(approvalId)}`;
    const url = `${publicBaseUrl(req)}/join/presenter?kitchen=${encodeURIComponent(kitchen)}&role=${encodeURIComponent(approver.role)}&next=${encodeURIComponent(next)}`;
    return Response.json({ mode: "enrol", ...base, url, qrSvg: await qrSvg(url) });
  });
}
