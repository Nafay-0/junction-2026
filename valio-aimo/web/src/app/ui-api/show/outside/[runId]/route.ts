import { DockError } from "@/core/errors";
import { showRoute } from "@/server/show/http";
import { nextOutside } from "@/server/show/outside";

/** GET ?after=<version>: the outside agent's run as soon as it changes (long poll). */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  return showRoute(req, async () => {
    const { runId } = await ctx.params;
    const after = Number(new URL(req.url).searchParams.get("after") ?? -1);
    const run = await nextOutside(runId, Number.isFinite(after) ? after : -1);
    if (!run) throw new DockError(404, "run_not_found", "No such run in this server.");
    return Response.json({ run });
  });
}
