import { SESSION_COOKIE, readCookie } from "@/server/approver-session";
import { publicBaseUrl } from "@/server/config";
import { getRuntime } from "@/server/runtime";

/**
 * GET /k/mine: the visitor's own kitchen shop. A visitor who joined from the wall's QR code has the approver
 * cookie on this phone; it names their sandbox kitchen. Anyone else lands on the list of demo kitchens.
 */
export async function GET(req: Request) {
  const rt = await getRuntime();
  const account = await rt.passkeys.sessionApprover(readCookie(req, SESSION_COOKIE));
  const sandbox = account ? await rt.sandboxes.forApprover(account.approverId) : undefined;
  const base = publicBaseUrl(req);
  return Response.redirect(`${base}${sandbox ? `/k/${sandbox.sandboxId}` : "/k"}`, 302);
}
