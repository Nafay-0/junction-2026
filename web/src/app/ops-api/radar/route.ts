import { DockError } from "@/core/orders";
import { readJson } from "@/server/http";
import { opsRead, opsRoute } from "@/server/ops/handler";
import { radar } from "@/server/radar/registry";
import { sourceOf, type SourceId } from "@/server/radar/sources";
import { radarView } from "@/server/radar/views";

/**
 * GET /ops-api/radar: sources and when each was checked, notices with their facts and sentences, matches waiting for
 * review, holds and the orders they touch, drills, and what the partners' APIs have cost.
 *
 * POST /ops-api/radar, one of:
 *   { action: "check", sourceId }                          check a source now
 *   { action: "review", matchId, decision: "confirm" | "dismiss", reason }
 *   { action: "lift", holdId, reason }
 *   { action: "drill", productId }                         publish a drill notice on Dock's own drill page
 *   { action: "end_drill", drillId }
 * Everything a person decides is written to the ledger with their name and reason.
 */
export async function GET(req: Request) {
  return opsRead(req, async (rt) => Response.json(await radarView(rt)));
}

export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
    const r = radar(rt);
    switch (body.action) {
      case "check": {
        const id = str("sourceId");
        if (!sourceOf(id)) throw new DockError(400, "invalid_request", `Unknown source ${id}.`);
        if (id === "drill") r.deps.drill.localOrigin = new URL(req.url).origin;
        return Response.json({ source: await r.checkSource(id as SourceId, { force: true }) });
      }
      case "review": {
        const decision = body.decision === "confirm" ? "confirm" : body.decision === "dismiss" ? "dismiss" : undefined;
        if (!decision) throw new DockError(400, "invalid_request", 'decision must be "confirm" or "dismiss".');
        return Response.json({ match: r.review(str("matchId"), { decision, reason: str("reason").slice(0, 300), by: staff.name }) });
      }
      case "lift":
        return Response.json({ hold: r.liftHold(str("holdId"), { reason: str("reason").slice(0, 300), by: staff.name }) });
      case "drill":
        return Response.json({ drill: await r.publishDrill({ productId: str("productId"), by: staff.name, origin: new URL(req.url).origin }) }, { status: 201 });
      case "end_drill":
        return Response.json({ drill: r.endDrill(str("drillId"), { by: staff.name }) });
      default:
        throw new DockError(400, "invalid_request", 'action must be "check", "review", "lift", "drill" or "end_drill".');
    }
  });
}
