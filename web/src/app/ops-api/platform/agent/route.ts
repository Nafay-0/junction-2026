import { DockError } from "@/core/errors";
import { readJson } from "@/server/http";
import { TRY_FREE, opsRead, opsTry } from "@/server/ops/handler";
import { launch, launcherStatus, type PresetId } from "@/server/aiven/showcase/launcher";
import { platformRoute } from "@/server/aiven/showcase/routes";
import { runsTodayFrom, telemetryWriter } from "@/server/aiven/showcase/writer";

/** GET /ops-api/platform/agent: presets, runs left today, recent runs. */
export async function GET(req: Request) {
  return opsRead(req, async (rt, staff) => {
    platformRoute(rt, staff);
    return Response.json(launcherStatus());
  });
}

/**
 * POST /ops-api/platform/agent { preset }: send in the Aiven Managed Agent buyer (or play a recording when the day's
 * runs are used). A visitor may try it (opsTry, door aiven-agent: 3 an hour per address, on top of the launcher's
 * own 12 a day, one at a time); a recording costs nothing and is not counted.
 */
export async function POST(req: Request) {
  return opsTry(req, "aiven-agent", async (rt, staff) => {
    platformRoute(rt, staff, { name: "agent launch", limit: 4, windowMs: 60_000 });
    const body = (await readJson(req, 4 * 1024)) as { preset?: unknown };
    const preset = String(body?.preset ?? "valio") as PresetId;
    const r = await launch(preset, { by: staff.viewer ? "a visitor" : staff.name, write: telemetryWriter(rt.aiven.pool), runsToday: runsTodayFrom(rt.aiven.pool) });
    if ("refused" in r) throw new DockError(429, r.refused.code, r.refused.reason, undefined, r.refused.retryInS ? { retryInS: r.refused.retryInS } : undefined);
    return Response.json({ run: r.run, status: launcherStatus() }, r.run.recorded ? { headers: { [TRY_FREE]: "recording" } } : undefined);
  }, { freeNow: recordingOnly });
}

/** Only a recording can play now (not configured here, or today's runs used): a visitor's press costs nothing. */
function recordingOnly(): boolean {
  const s = launcherStatus();
  return !s.configured || Boolean(s.blocked?.recording);
}
