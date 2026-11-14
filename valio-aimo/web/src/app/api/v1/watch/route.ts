import { handle } from "@/server/http";
import { restWatch } from "@/server/watch/rest";

/** GET /api/v1/watch[?fresh=true]: what may not arrive (with ranked substitutes and the signed claim), the learned recurring orders and their drift, renewals placed or held. */
export async function GET(req: Request) {
  return handle(async (rt) => Response.json(await restWatch(rt, req, "watch_orders", new URL(req.url).searchParams.get("fresh") === "true" ? { fresh: true } : {})));
}
