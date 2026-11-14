import { requireSameOrigin } from "@/server/accounts/http";
import { accountsView } from "@/server/accounts/ops-view";
import { opsRoute } from "@/server/ops/handler";

/** POST /ops-api/accounts/reset: put the shared test accounts back to their seed (rules, mandate, history). */
export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    requireSameOrigin(req, { json: false });
    const r = await rt.accounts.resetTestAccounts(`by ${staff.name} from the operations portal`);
    return Response.json({ ...r, ...(await accountsView(rt)) });
  });
}
