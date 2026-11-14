import { DockError } from "@/core/errors";
import { showRoute } from "@/server/show/http";
import { RECORDING_KINDS, loadRecording, type RecordingKind } from "@/server/show/recordings";

/** GET: the fallback recording for an act (week, attacks, outside): a real earlier run's frames, to replay. */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  return showRoute(req, async () => {
    const { kind } = await ctx.params;
    if (!RECORDING_KINDS.includes(kind as RecordingKind)) throw new DockError(404, "recording_unknown", `No recording kind ${kind}.`);
    const recording = await loadRecording(kind as RecordingKind);
    if (!recording) throw new DockError(404, "recording_missing", `No ${kind} recording on this server yet: run it live once.`);
    return Response.json({ recording });
  });
}
