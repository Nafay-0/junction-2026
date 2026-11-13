import { opsRoute } from "@/server/ops/handler";
import { panels, type Range } from "@/server/aiven/showcase/panels";
import { platformRoute } from "@/server/aiven/showcase/routes";

/** GET /ops-api/platform/panels?range=1h|24h|7d: the dashboard's panels, read as the read-only user, each with its SQL. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "panel", limit: 40, windowMs: 60_000 });
    const range = new URL(req.url).searchParams.get("range");
    return Response.json(await panels(range === "1h" || range === "7d" ? (range as Range) : "24h", rt.catalogSource.kind === "valio" ? rt.catalogSource.products : undefined));
  });
}
