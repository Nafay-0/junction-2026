import { opsRoute } from "@/server/ops/handler";
import { latestRequestId } from "@/server/ops/views";

/** GET /ops-api/trace: the most recent request's id, so /ops/trace can open it. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => Response.json({ requestId: (await latestRequestId(rt)) ?? null }));
}
