import { DockError } from "@/core/errors";
import { showRoute } from "@/server/show/http";
import { stopWeek } from "@/server/show/registry";

/** POST: stop the week now; the kitchen is cleaned up (waiting orders withdrawn, its own past put back). */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  return showRoute(req, async () => {
    const { runId } = await ctx.params;
    const run = await stopWeek(runId);
    if (!run) throw new DockError(404, "week_not_found", "No such week.");
    return Response.json({ run });
  });
}
