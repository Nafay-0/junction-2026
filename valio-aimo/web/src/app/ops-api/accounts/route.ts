import { opsRead } from "@/server/ops/handler";
import { accountsView } from "@/server/accounts/ops-view";

/** GET /ops-api/accounts: every account as a kitchen, with when it signed up and last ordered. Nothing about the person. */
export async function GET(req: Request) {
  return opsRead(req, async (rt) => Response.json(await accountsView(rt), { headers: { "cache-control": "no-store" } }));
}
