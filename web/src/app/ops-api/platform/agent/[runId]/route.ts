import { DockError } from "@/core/errors";
import { opsRoute } from "@/server/ops/handler";
import { getRun } from "@/server/aiven/showcase/launcher";

/** GET /ops-api/platform/agent/{runId}: one run as it goes: the agent's tool calls and Dock's answers, redacted. */
export async function GET(req: Request, ctx: RouteContext<"/ops-api/platform/agent/[runId]">) {
  const { runId } = await ctx.params;
  return opsRoute(req, async () => {
    const run = getRun(runId);
    if (!run) throw new DockError(404, "run_not_found", "No such run on this server (runs are kept in memory, the last 30).");
    return Response.json(run);
  });
}
