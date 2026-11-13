import { handle } from "@/server/http";
import { currentOps } from "@/server/ops/access";
import { wallSnapshot } from "@/server/wall-snapshot";

/**
 * GET /ui-api/wall: the big screen's counts, feed and refusals, in plain sentences. The wall's own back end.
 * Public: visitors' kitchens are listed by name only; their ids (which open their consoles to their owner and start
 * their demo order) go only to a screen signed in to the operations desk (server/authz.ts).
 */
export async function GET(req: Request) {
  return handle(async (rt) => {
    const snap = await wallSnapshot(rt);
    if (!currentOps(req)) snap.kitchens = snap.kitchens.map((k) => ({ ...k, slug: "" }));
    return Response.json(snap, { headers: { "cache-control": "no-store" } });
  });
}
