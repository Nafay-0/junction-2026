import { currentApprover, handleApprover } from "@/server/approver-session";
import { eurShort } from "@/server/approval-view";
import { demoTapEnabled, isSecureOrigin, relyingParty } from "@/server/config";
import { SANDBOX_PER_ORDER_LIMIT_CENTS } from "@/server/dev-fixtures";

/**
 * Step 1 of joining by QR code: who the visitor is about to become, and the passkey prompt to create.
 * Nothing is created until the phone returns a passkey to POST /api/v1/join/verify.
 */
export async function POST(req: Request) {
  return handleApprover(async (rt) => {
    const rp = relyingParty(req);
    const current = await currentApprover(req, rt);
    const { options, identity } = await rt.sandboxes.beginJoin(rp);
    return Response.json({
      options,
      identity,
      perOrderLimit: eurShort(SANDBOX_PER_ORDER_LIMIT_CENTS),
      current: current?.sandbox ? { kitchenName: current.sandbox.kitchenName, approverName: current.sandbox.approverName, expiresAt: current.sandbox.expiresAt } : undefined,
      secureOrigin: isSecureOrigin(rp.origins[0]),
      demoTapEnabled: demoTapEnabled(),
    });
  });
}
