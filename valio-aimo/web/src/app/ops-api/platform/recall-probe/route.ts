import { opsRead, opsTry } from "@/server/ops/handler";
import { platformRoute } from "@/server/aiven/showcase/routes";
import { lastProbe, runProbe } from "@/server/search/probe-run";

/**
 * GET  /ops-api/platform/recall-probe: the last "Time both search backends" run on this server, or null.
 * POST /ops-api/platform/recall-probe: run it now (about 30 queries through memory and OpenSearch recall; query
 * embeddings only, no judge). One run a minute on the server; a visitor may try it (opsTry, door search-timing: one
 * per 10 minutes per address, 60 a day for all visitors).
 */
export async function GET(req: Request) {
  return opsRead(req, async () => Response.json({ last: lastProbe() ?? null }, { headers: { "cache-control": "no-store" } }));
}

export async function POST(req: Request) {
  return opsTry(req, "search-timing", async (rt, staff) => {
    platformRoute(rt, staff, { name: "recall probe", limit: 1, windowMs: 60_000 });
    return Response.json({ last: await runProbe(rt, staff.viewer ? "a visitor" : staff.name) }, { headers: { "cache-control": "no-store" } });
  });
}
