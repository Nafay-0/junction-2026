import { DockError } from "@/core/errors";
import { showRoute } from "@/server/show/http";
import { saveRecording } from "@/server/show/recordings";
import { recordingOf } from "@/server/show/registry";

/** POST: keep this finished live week as the fallback recording for the week act. */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  return showRoute(req, async (_rt, staff) => {
    const { runId } = await ctx.params;
    const rec = recordingOf(runId, `live run ${runId}, saved by ${staff.name}`);
    if (!rec) throw new DockError(409, "week_not_finished", "Only a finished week can be kept as a recording.");
    const saved = await saveRecording(rec);
    return Response.json({ saved });
  });
}
