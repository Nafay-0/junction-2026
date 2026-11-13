import { approvalLink, qrSvg } from "@/server/approval-links";
import { demoTapEnabled, publicBaseUrl } from "@/server/config";
import { errorBody, handle } from "@/server/http";
import { withKitchen } from "../../../_shared";

/**
 * GET /ui-api/plan/{kitchen}/approval/{approvalId}: the QR code the plan shows while its order waits for sign-off.
 * The menu kitchens' named approvers are fictional and have no passkey, so outside production (or with
 * DOCK_DEMO_TAP_APPROVAL on) the code carries the one-time link Dock "sent to their phone", as for the console's
 * demo kitchens; whoever scans it signs in that person's place. Otherwise it shows the sign-off page to view.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]/approval/[approvalId]">) {
  return handle(async ({ dock, outbox }) => {
    const { kitchen: slug, approvalId } = await ctx.params;
    const { kitchen } = await withKitchen(slug);
    const c = await dock.approvalContext(approvalId);
    if (c.order.orgId !== kitchen.mandate.issuer.orgId) return Response.json(errorBody("approval_not_found", "No such sign-off for this kitchen."), { status: 404 });
    const approver = { name: c.approval.approver.name, role: c.approval.approver.role };
    const msg = outbox.messages().find((m) => m.approvalId === approvalId);
    if (msg && (process.env.NODE_ENV !== "production" || demoTapEnabled())) {
      const url = `${publicBaseUrl(req)}${msg.link}`;
      return Response.json({ mode: "demo_link", approver, status: c.approval.status, url, qrSvg: await qrSvg(url) });
    }
    const link = await approvalLink(approvalId, req);
    return Response.json({ mode: "view_only", approver, status: c.approval.status, url: link.url, qrSvg: link.qrSvg });
  });
}
