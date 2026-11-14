import { conversationView } from "@/server/ops/conversation";
import { opsRoute } from "@/server/ops/handler";

/** GET /ops-api/conversation/{threadId}: one kitchen's conversation with its agent, turn by turn, from the ledger. */
export async function GET(req: Request, ctx: RouteContext<"/ops-api/conversation/[threadId]">) {
  const { threadId } = await ctx.params;
  return opsRoute(req, async (rt) => Response.json(await conversationView(rt, threadId)));
}
