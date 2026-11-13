import { handleApprover } from "@/server/approver-session";
import { isSecureOrigin, relyingParty } from "@/server/config";
import { readJson } from "@/server/http";
import { clientAddress } from "@/server/limits";
import { beginPresenterEnrolment, presenterRoles } from "@/server/presenter";

/**
 * GET  /ui-api/presenter/enrol?kitchen=laakso   the approver roles a presenter can take at a built-in demo kitchen
 * POST /ui-api/presenter/enrol  { kitchen, role, passcode, presenter? }  -> { options, approver, replaces? }
 *
 * Step 1 of a presenter becoming a demo kitchen's approver on their own phone (see server/presenter.ts). The
 * operations passcode is checked before any passkey prompt exists. Not part of the public API.
 */
export async function GET(req: Request) {
  return handleApprover(async (rt) => {
    const slug = new URL(req.url).searchParams.get("kitchen") ?? "";
    const roles = presenterRoles(slug);
    if (!roles) return Response.json({ error: { code: "kitchen_not_found", message: "Presenters can only enrol for the built-in demo kitchens (kaari, laakso)." } }, { status: 404 });
    const enrolled = await Promise.all(roles.map(async (r) => ({ ...r, enrolled: !!(await rt.passkeys.store.findApprover(r.orgId, r.role)) })));
    return Response.json({ roles: enrolled, secureOrigin: isSecureOrigin(relyingParty(req).origins[0]) }, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(req: Request) {
  return handleApprover(async (rt) => {
    const body = (await readJson(req)) as { kitchen?: unknown; role?: unknown; passcode?: unknown; presenter?: unknown };
    const out = await beginPresenterEnrolment(rt, relyingParty(req), { ...body, client: clientAddress(req.headers) });
    return Response.json(out, { headers: { "cache-control": "no-store" } });
  });
}
