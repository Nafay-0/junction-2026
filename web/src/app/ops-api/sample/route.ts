import { readJson } from "@/server/http";
import { opsRoute } from "@/server/ops/handler";
import { refreshSample, sampleStatus } from "@/server/alive/start";
import { hidesSample } from "@/server/alive/clock";

/**
 * GET /ops-api/sample: whether this server shows sample activity, the current set, and the items "Start here" links to.
 * POST /ops-api/sample { action: "refresh" }: mark the earlier sample superseded (nothing leaves the ledger) and play a
 * new set now. Operations staff only.
 */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => Response.json({ ...sampleStatus(rt), hidden: hidesSample(req.headers.get("cookie")) }));
}

export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    const body = (await readJson(req).catch(() => ({}))) as { action?: unknown };
    if (body.action !== "refresh") return Response.json({ error: { code: "invalid_request", message: 'Send { "action": "refresh" }.' } }, { status: 400 });
    const r = await refreshSample(rt, staff.name ?? "operations staff");
    return Response.json({ ...sampleStatus(rt), played: r ? { set: r.setId, ms: r.ms, beats: r.beats.length, failed: r.beats.filter((b) => !b.ok).map((b) => b.name) } : null });
  });
}
