import { currentAccount } from "@/server/accounts/http";
import { noStore } from "@/server/accounts/routes";
import { handle } from "@/server/http";

/** GET /ui-api/account: who is signed in here (username, restaurant, its kitchen's address), or { account: null }. */
export async function GET(req: Request) {
  return handle(async (rt) => {
    const s = await currentAccount(req, rt);
    return Response.json({ account: s ? rt.accounts.view(s.account) : null }, { headers: noStore });
  });
}
