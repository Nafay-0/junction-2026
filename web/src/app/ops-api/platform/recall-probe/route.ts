import { opsRead, opsRoute } from "@/server/ops/handler";
import { platformRoute } from "@/server/aiven/showcase/routes";
import { lastProbe, runProbe } from "@/server/search/probe-run";

/**
 * GET  /ops-api/platform/recall-probe: the last "Time both search backends" run on this server, or null.
 * POST /ops-api/platform/recall-probe: run it now (about 30 queries through memory and OpenSearch recall; query
 * embeddings only, no judge). Operations staff only; one run a minute.
 */
export async function GET(req: Request) {
  return opsRead(req, async () => Response.json({ last: lastProbe() ?? null }, { headers: { "cache-control": "no-store" } }));
}

export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "recall probe", limit: 1, windowMs: 60_000 });
    return Response.json({ last: await runProbe(rt, staff.name) }, { headers: { "cache-control": "no-store" } });
  });
}
