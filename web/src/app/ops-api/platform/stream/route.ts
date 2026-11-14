import { opsRead } from "@/server/ops/handler";
import { needKafka, platformRoute } from "@/server/aiven/showcase/routes";
import { lag, streamConfigured, tail } from "@/server/aiven/showcase/stream";

/**
 * GET /ops-api/platform/stream?after=<partition>:<offset>: the newest messages on dock.actions and the sink's lag. The
 * consumer's last error goes out as `problem`, beside the messages it still has: a top-level `error` would make the
 * page's fetch read the whole answer as a failure and drop the messages.
 */
export async function GET(req: Request) {
  return opsRead(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "stream", limit: 120, windowMs: 60_000 });
    needKafka(streamConfigured());
    const after = new URL(req.url).searchParams.get("after") ?? undefined;
    const [t, l] = await Promise.all([tail(after && /^\d+:\d+$/.test(after) ? after : undefined), lag()]);
    const { error, ...rest } = t;
    return Response.json({ ...rest, problem: error, lag: l });
  });
}
