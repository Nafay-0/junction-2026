import { opsRoute } from "@/server/ops/handler";
import { traceView } from "@/server/ops/views";

/** GET /ops-api/trace/{requestId}: one request as a path through Dock, step by step, each step with its ledger entry. */
export async function GET(req: Request, ctx: RouteContext<"/ops-api/trace/[requestId]">) {
  const { requestId } = await ctx.params;
  return opsRoute(req, async (rt) => Response.json(await traceView(rt, requestId)));
}
