import { DockError } from "@/core/errors";
import { showRoute } from "@/server/show/http";
import { nextWeek } from "@/server/show/registry";

/** GET ?after=<version>: the run as soon as it changes past that version (long poll, at most 15 s). */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  return showRoute(req, async () => {
    const { runId } = await ctx.params;
    const after = Number(new URL(req.url).searchParams.get("after") ?? -1);
    const run = await nextWeek(runId, Number.isFinite(after) ? after : -1);
    if (!run) throw new DockError(404, "week_not_found", "No such week in this server; it may have been restarted.");
    return Response.json({ run });
  });
}
