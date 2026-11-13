import { opsRoute } from "@/server/ops/handler";
import { platformOverview } from "@/server/aiven/showcase/platform";
import { platformRoute } from "@/server/aiven/showcase/routes";

/** GET /ops-api/platform/overview: every Aiven service, its job, live status and round trip, its last hour, and the cost. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "overview", limit: 60, windowMs: 60_000 });
    return Response.json(await platformOverview(rt.aiven));
  });
}
