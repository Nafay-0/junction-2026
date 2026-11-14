import { accountCookie } from "@/server/accounts/http";
import { accountRoute, noStore } from "@/server/accounts/routes";
import { readJson } from "@/server/http";

/**
 * POST /ui-api/account/signup { restaurant, username, password }: step 1 of opening an account. Nothing else is
 * asked: no email address, no person's name. Signs this browser in; step 2 is signing the mandate
 * (POST /ui-api/account/mandate), which makes the kitchen.
 */
export async function POST(req: Request) {
  return accountRoute(req, async (rt, { address }) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const s = await rt.accounts.signUp({ restaurant: body.restaurant, username: body.username, password: body.password }, address);
    return Response.json({ account: s.account, next: "/k/signup?step=rules" }, { status: 201, headers: { ...noStore, "set-cookie": accountCookie(req, s.token, s.expiresAt) } });
  });
}
