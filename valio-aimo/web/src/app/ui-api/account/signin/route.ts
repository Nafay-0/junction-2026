import { accountCookie } from "@/server/accounts/http";
import { accountRoute, noStore } from "@/server/accounts/routes";
import { readJson } from "@/server/http";

/**
 * POST /ui-api/account/signin { username, password }. The same 401 for an unknown username and a wrong password;
 * failed attempts are limited per account and per address (429 with the wait).
 */
export async function POST(req: Request) {
  return accountRoute(req, async (rt, { address }) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const s = await rt.accounts.signIn({ username: body.username, password: body.password }, address);
    const next = s.account.kitchen ? `/k/${s.account.kitchen}` : "/k/signup?step=rules";
    return Response.json({ account: s.account, next }, { headers: { ...noStore, "set-cookie": accountCookie(req, s.token, s.expiresAt) } });
  });
}
