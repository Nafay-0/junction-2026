import { getRuntime } from "@/server/runtime";
import { renderDrillNotice } from "@/server/radar/drill";
import { radarStore } from "@/server/radar/store";

/** GET /ui-api/radar/drill/{slug}: one drill notice page (HARJOITUS / DRILL, not a real recall). */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/radar/drill/[slug]">) {
  void req.url;
  const { slug } = await ctx.params;
  const { dock } = await getRuntime();
  const d = radarStore(dock).state.drills.find((x) => x.slug === slug);
  if (!d) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(renderDrillNotice(d), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
