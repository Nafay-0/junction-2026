import { DockError } from "@/core/errors";
import { opsRoute } from "@/server/ops/handler";
import { needKafka, platformRoute } from "@/server/aiven/showcase/routes";
import { requestEvents, streamConfigured } from "@/server/aiven/showcase/stream";

/**
 * GET /ops-api/platform/stream/request/{requestId}: the request's events read back from Kafka, in the gate's order,
 * with the partition and offset of each, for the trace's replay. The time window comes from the ledger (or ?from&to).
 */
export async function GET(req: Request, ctx: RouteContext<"/ops-api/platform/stream/request/[requestId]">) {
  const { requestId } = await ctx.params;
  return opsRoute(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "stream replay", limit: 20, windowMs: 60_000 });
    needKafka(streamConfigured());
    if (!/^req_[a-z0-9]{6,40}$/.test(requestId)) throw new DockError(400, "bad_request_id", "Not a request id.");
    const q = new URL(req.url).searchParams;
    const entries = rt.dock.ledger.entries().filter((e) => e.requestId === requestId);
    const from = entries[0]?.at ?? q.get("from");
    const to = entries.at(-1)?.at ?? q.get("to") ?? from;
    if (!from || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to!))) throw new DockError(404, "request_not_found", "This request is not in this server's ledger; give ?from=&to= (ISO times) to read the stream anyway.");
    if (Date.parse(to!) - Date.parse(from) > 6 * 3_600_000) throw new DockError(400, "window_too_long", "A request's events are read from a window of at most 6 hours.");
    return Response.json({ requestId, window: { from, to }, ledgerSteps: entries.length, ...(await requestEvents(requestId, { from, to: to! })) });
  });
}
