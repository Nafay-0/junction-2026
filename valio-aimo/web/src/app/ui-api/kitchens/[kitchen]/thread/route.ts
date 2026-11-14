import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { readThread } from "@/server/thread/engine";

/**
 * GET /ui-api/kitchens/{kitchen}/thread: the kitchen's conversation with its agent, every turn and card so far,
 * and `seq` to resume the event stream from (docs/agent-thread.md).
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/thread">) {
  return portalRoute(req, ctx.params, async (k) => Response.json({ thread: await readThread(k) }, noStore));
}
