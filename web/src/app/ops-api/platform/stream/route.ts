import { opsRead } from "@/server/ops/handler";
import { needKafka, platformRoute } from "@/server/aiven/showcase/routes";
import { lag, streamConfigured, tail } from "@/server/aiven/showcase/stream";

/** GET /ops-api/platform/stream?after=<partition>:<offset>: the newest messages on dock.actions and the sink's lag. */
export async function GET(req: Request) {
  return opsRead(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "stream", limit: 120, windowMs: 60_000 });
    needKafka(streamConfigured());
    const after = new URL(req.url).searchParams.get("after") ?? undefined;
    const [t, l] = await Promise.all([tail(after && /^\d+:\d+$/.test(after) ? after : undefined), lag()]);
    return Response.json({ ...t, lag: l });
  });
}
