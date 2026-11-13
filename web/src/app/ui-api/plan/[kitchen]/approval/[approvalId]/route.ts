import { demoApprovalQr } from "@/server/presenter";
import { errorBody, handle } from "@/server/http";
import { withKitchen } from "../../../_shared";

/**
 * GET /ui-api/plan/{kitchen}/approval/{approvalId}: the QR code the plan shows while its order waits for sign-off.
 * The menu kitchens' named approvers are fictional and have no passkey, so outside production (or with
 * DOCK_DEMO_TAP_APPROVAL on) the code carries the one-time link Dock "sent to their phone", as for the console's
 * demo kitchens; whoever scans it signs in that person's place. Otherwise a presenter enrols a passkey for that
 * role (operations passcode) and signs like a visitor (server/presenter.ts demoApprovalQr).
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]/approval/[approvalId]">) {
  return handle(async (rt) => {
    const { dock } = rt;
    const { kitchen: slug, approvalId } = await ctx.params;
    const { kitchen } = await withKitchen(slug);
    const c = await dock.approvalContext(approvalId);
    if (c.order.orgId !== kitchen.mandate.issuer.orgId) return Response.json(errorBody("approval_not_found", "No such sign-off for this kitchen."), { status: 404 });
    return Response.json(await demoApprovalQr(rt, req, slug, approvalId));
  });
}
