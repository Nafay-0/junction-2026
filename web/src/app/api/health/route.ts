import { handle } from "@/server/http";
import { healthReport } from "@/server/health";

/**
 * Liveness and what is running: git commit, catalogue source and size, which backing services answer. No secrets.
 * `dataPlane` (src/server/aiven): which Aiven adapters this process uses, each service's reachability and check
 * time through the adapters' own clients, and the counters (cache hits and misses, events published and consumed).
 */
export async function GET(req: Request) {
  void req.url; // request-time route
  return handle(async (rt) => Response.json({ ...(await healthReport(rt, req)), dataPlane: await rt.aiven.health() }, { headers: { "cache-control": "no-store" } }));
}
