import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { DockError } from "@/core/orders";
import { handleApprover, sessionCookie } from "@/server/approver-session";
import { demoTapEnabled } from "@/server/config";
import { readJson } from "@/server/http";

/**
 * Step 2 of joining: { response } from startRegistration(). Creates the visitor's kitchen and signs this phone in.
 * DEMO ONLY: { fallback: true } joins without a passkey when DOCK_DEMO_TAP_APPROVAL=1.
 */
export async function POST(req: Request) {
  return handleApprover(async (rt) => {
    const body = (await readJson(req)) as { response?: RegistrationResponseJSON; fallback?: unknown };
    let joined;
    if (body.fallback === true) {
      if (!demoTapEnabled()) throw new DockError(403, "demo_tap_disabled", "Joining without a passkey is switched off on this server.", "approver_identity");
      joined = await rt.sandboxes.joinWithoutPasskey();
    } else if (body.response && typeof body.response === "object") {
      joined = await rt.sandboxes.completeJoin(body.response);
    } else {
      throw new DockError(400, "invalid_request", "Send { response } from the passkey prompt.");
    }
    return Response.json(
      { sandbox: joined.sandbox, next: "/approver" },
      { status: 201, headers: { "set-cookie": sessionCookie(req, joined.sessionToken, joined.sandbox.expiresAt) } },
    );
  });
}
