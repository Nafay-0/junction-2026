import { readJson } from "@/server/http";
import { opsRead, opsRoute } from "@/server/ops/handler";
import { refreshSample, sampleStatus } from "@/server/alive/start";
import { hidesSample } from "@/server/alive/clock";
import { cleanSample, sampleCheck } from "@/server/alive/clean";

/**
 * GET /ops-api/sample: whether this server shows sample activity, the current set, and the items "Start here" links to.
 * POST /ops-api/sample { action: "refresh" }: mark the earlier sample superseded (nothing leaves the ledger) and play a
 * new set now. Operations staff only.
 * POST /ops-api/sample { action: "clean" }: clear what an earlier sample left in kitchens people sign into (Kaari,
 * Laakso, the test kitchens), only records the sample marked as its own (server/alive/clean.ts). Staff only.
 * GET /ops-api/sample?check=1: what a person signing in would meet of the sample, and the waiting count.
 */
export async function GET(req: Request) {
  // Readable without the passcode: a viewer sees the sample banner and "Start here" too. Refreshing is staff only.
  if (new URL(req.url).searchParams.get("check")) return opsRoute(req, async (rt) => Response.json(await sampleCheck(rt)));
  return opsRead(req, async (rt) => Response.json({ ...sampleStatus(rt), hidden: hidesSample(req.headers.get("cookie")) }));
}

export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    const body = (await readJson(req).catch(() => ({}))) as { action?: unknown };
    if (body.action === "clean") return Response.json({ cleared: await cleanSample(rt, staff.name ?? "operations staff"), check: await sampleCheck(rt) });
    if (body.action !== "refresh") return Response.json({ error: { code: "invalid_request", message: 'Send { "action": "refresh" } or { "action": "clean" }.' } }, { status: 400 });
    const r = await refreshSample(rt, staff.name ?? "operations staff");
    return Response.json({ ...sampleStatus(rt), played: r ? { set: r.setId, ms: r.ms, beats: r.beats.length, failed: r.beats.filter((b) => !b.ok).map((b) => b.name) } : null });
  });
}
