import { departments } from "@/server/kitchen-catalog";
import { portalRoute } from "@/server/kitchen-portal-http";

/** GET /ui-api/kitchens/{kitchen}/catalog/categories: departments and categories with derived labels and counts. */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/catalog/categories">) {
  void req.url;
  return portalRoute(req, ctx.params, async () => Response.json({ departments: await departments() }, { headers: { "cache-control": "private, max-age=300" } }));
}
