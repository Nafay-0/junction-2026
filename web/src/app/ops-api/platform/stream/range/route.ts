import { DockError } from "@/core/errors";
import { opsRoute } from "@/server/ops/handler";
import { needKafka, platformRoute } from "@/server/aiven/showcase/routes";
import { MAX_RANGE, readRanges, streamConfigured } from "@/server/aiven/showcase/stream";

/** GET /ops-api/platform/stream/range?partition=0&from=100&to=150: messages of one partition by offset, at most 500. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "stream range", limit: 12, windowMs: 60_000 });
    needKafka(streamConfigured());
    const q = new URL(req.url).searchParams;
    const partition = Number(q.get("partition"));
    const from = q.get("from") ?? "";
    const to = q.get("to") ?? "";
    if (!Number.isInteger(partition) || partition < 0 || partition > 15 || !/^\d{1,15}$/.test(from) || !/^\d{1,15}$/.test(to) || Number(to) < Number(from)) {
      throw new DockError(400, "bad_range", `Give partition, from and to as offsets (to >= from, at most ${MAX_RANGE} apart).`);
    }
    return Response.json({ partition, from, to: String(Math.min(Number(to), Number(from) + MAX_RANGE)), ...(await readRanges([{ partition, from, to }])) });
  });
}
