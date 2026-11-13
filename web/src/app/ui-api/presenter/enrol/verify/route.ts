import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { DockError } from "@/core/errors";
import { handleApprover, sessionCookie } from "@/server/approver-session";
import { readJson } from "@/server/http";
import { completePresenterEnrolment } from "@/server/presenter";

/** Step 2: { response } from startRegistration(). Stores the passkey as the demo kitchen role's approver and signs this phone in. */
export async function POST(req: Request) {
  return handleApprover(async (rt) => {
    const body = (await readJson(req)) as { response?: RegistrationResponseJSON };
    if (!body.response || typeof body.response !== "object") throw new DockError(400, "invalid_request", "Send { response } from the passkey prompt.");
    const done = await completePresenterEnrolment(rt, body.response);
    return Response.json({ approver: done.approver, expiresAt: done.expiresAt }, { status: 201, headers: { "set-cookie": sessionCookie(req, done.sessionToken, done.expiresAt), "cache-control": "no-store" } });
  });
}
