import { getRuntime } from "@/server/runtime";
import { renderDrillListing } from "@/server/radar/drill";
import { radarStore } from "@/server/radar/store";

/**
 * GET /ui-api/radar/drill: Dock's own drill page, a recall list in the Finnish Food Authority's layout, marked
 * HARJOITUS / DRILL. Public, so Context.dev can read it from a deployed address exactly as it reads the authority.
 */
export async function GET(req: Request) {
  void req.url;
  const { dock } = await getRuntime();
  return new Response(renderDrillListing(radarStore(dock).state.drills), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
