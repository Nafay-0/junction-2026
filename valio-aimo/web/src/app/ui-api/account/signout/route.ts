import { accountTokenOf, clearAccountCookie } from "@/server/accounts/http";
import { accountRoute, noStore } from "@/server/accounts/routes";

/** POST /ui-api/account/signout: ends this session on the server (the cookie stops working anywhere) and clears it. */
export async function POST(req: Request) {
  return accountRoute(req, async (rt) => {
    await rt.accounts.signOut(accountTokenOf(req));
    return Response.json({ signedOut: true, next: "/k" }, { headers: { ...noStore, "set-cookie": clearAccountCookie(req) } });
  });
}
