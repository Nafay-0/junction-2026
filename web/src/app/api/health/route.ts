import { aivenHealth } from "@/server/aiven";
import { errMessage } from "@/server/aiven/env";
import { getRuntime } from "@/server/runtime";

/**
 * GET /api/health: per Aiven service, reachable or not and how long the check took, which adapters are on,
 * and the data-plane counters (cache hits and misses, events published and consumed, search fallbacks).
 * 200 when every service an adapter uses answers, 503 otherwise. No secrets. Checks are cached for 5 s.
 */
export async function GET(req: Request) {
  void req.url; // request-time route
  try {
    const rt = await getRuntime();
    const report = await rt.aiven.health();
    return Response.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (err) {
    // The runtime did not start (for example PostgreSQL unreachable at boot): still say what is reachable.
    const report = await aivenHealth();
    return Response.json({ ...report, ok: false, runtimeError: errMessage(err) }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
