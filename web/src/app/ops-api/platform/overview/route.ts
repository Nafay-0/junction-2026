import { opsRoute } from "@/server/ops/handler";
import { platformOverview } from "@/server/aiven/showcase/platform";
import { platformRoute } from "@/server/aiven/showcase/routes";
import { alertsNow } from "@/server/ops/agent-watch";
import { recallStats } from "@/server/search/service";
import { partnerGate } from "@/server/valio/partner-gate";
import { timeMachineOf } from "@/server/mariadb/attach";

/** GET /ops-api/platform/overview: every Aiven service, its job, live status and round trip, its last hour, and the cost. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    platformRoute(rt, staff, { name: "overview", limit: 60, windowMs: 60_000 });
    const [overview, alerts] = await Promise.all([platformOverview(rt.aiven), alertsNow(rt)]);
    const tm = timeMachineOf(rt.dock);
    const history = tm ? { backend: tm.backend, label: tm.label, display: tm.display, backfill: tm.backfill.state, moments: tm.backfill.report?.moments ?? null, builtAt: tm.backfill.report?.at ?? null } : null;
    return Response.json({ ...overview, alerts, recall: recallStats() ?? null, partner: partnerGate().state(), history });
  });
}
