import { handle } from "@/server/http";
import { wallSnapshot } from "@/server/wall-snapshot";

/** GET /ui-api/wall: the big screen's counts, feed and refusals, in plain sentences. The wall's own back end. */
export async function GET(req: Request) {
  void req.url; // request-time route
  return handle(async (rt) => Response.json(await wallSnapshot(rt), { headers: { "cache-control": "no-store" } }));
}
