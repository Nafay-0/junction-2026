import { opsRoute } from "@/server/ops/handler";
import { agentScorecard, alertsNow, escalationQueue } from "@/server/ops/agent-watch";
import type { ScoreWindow } from "@/server/ops/scorecard";

/**
 * GET /ops-api/agents/watch?window=1h|today|24h: the scorecard per agent (figures, status and reason, the SQL), the
 * escalation queue (oldest first) and the alerts. Read only: the actions it proposes go through Control.
 */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => {
    const w = new URL(req.url).searchParams.get("window");
    const window: ScoreWindow = w === "1h" || w === "24h" ? w : "today";
    const [scorecard, queue, alerts] = await Promise.all([agentScorecard(rt, window), escalationQueue(rt), alertsNow(rt)]);
    return Response.json({ scorecard, queue, alerts }, { headers: { "cache-control": "no-store" } });
  });
}
