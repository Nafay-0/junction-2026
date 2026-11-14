import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { resetThread } from "@/server/thread/engine";

/** POST /ui-api/kitchens/{kitchen}/thread/reset: start the conversation over. The old one stays in the ledger and the trace. */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/thread/reset">) {
  return portalRoute(req, ctx.params, async (k) => Response.json({ thread: await resetThread(k) }, noStore));
}
