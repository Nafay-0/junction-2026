import { DockError } from "@/core/errors";
import { currentApprover } from "@/server/approver-session";
import { accountCookie } from "@/server/accounts/http";
import { accountRoute, noStore } from "@/server/accounts/routes";
import { readJson } from "@/server/http";

/**
 * POST /ui-api/account/keep { username, password }: a visitor from the QR code keeps their kitchen before its 90
 * minutes end. Only from the phone that joined it (its approver cookie). Same kitchen, memory, orders and passkey.
 */
export async function POST(req: Request) {
  return accountRoute(req, async (rt, { address }) => {
    const me = await currentApprover(req, rt);
    if (!me?.sandbox) throw new DockError(401, "not_joined", "Only the phone that joined a visitor kitchen can keep it.", "account");
    const body = (await readJson(req)) as Record<string, unknown>;
    const s = await rt.accounts.keepVisitor(me.sandbox.sandboxId, me.account.approverId, { username: body.username, password: body.password }, address);
    return Response.json({ account: s.account, next: `/k/${s.account.username}` }, { status: 201, headers: { ...noStore, "set-cookie": accountCookie(req, s.token, s.expiresAt) } });
  });
}
