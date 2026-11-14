import { DockError } from "@/core/orders";
import { readJson } from "@/server/http";
import { opsRoute } from "@/server/ops/handler";
import { findingClaim, liftStage, runWatch, stageDrift, stageStockOut, stageableKitchens, watchView } from "@/server/watch/service";

/**
 * GET /ops-api/watch: what the kitchen agents' watch found (for which kitchen, what it proposed, what was decided and
 * by whom), every renewal placed or held with the reason, auto-renew settings with who switched them, staged
 * conditions, and the kitchens conditions can be staged for.
 *
 * POST /ops-api/watch, one of:
 *   { action: "run", kitchens?, fresh? }                            run the watch now (renewals due now too)
 *   { action: "stage_stock_out", kitchen, productId, until? }       demo and visitor kitchens only; marked staged
 *   { action: "stage_drift", kitchen, family, cost? }               a creeping recurring order; marked staged
 *   { action: "lift", stageId }                                     back to the live figures, the real orders
 *   { action: "claim", findingId }                                  a finding's signed availability claim, to check
 * Everything is written to the ledger with the staff member's name.
 */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => Response.json({ ...(await watchView(rt)), kitchens: await stageableKitchens(rt) }));
}

export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, 80) : "");
    switch (body.action) {
      case "run": {
        const kitchens = Array.isArray(body.kitchens) ? body.kitchens.filter((k): k is string => typeof k === "string").slice(0, 50) : undefined;
        return Response.json({ run: await runWatch(rt, { kitchens, by: staff.name, fresh: body.fresh === true, renew: "now" }) });
      }
      case "stage_stock_out":
        if (!str("kitchen") || !str("productId")) throw new DockError(400, "invalid_request", "Name the kitchen and the product.");
        return Response.json({ stage: await stageStockOut(rt, { kitchen: str("kitchen"), productId: str("productId"), ...(str("until") ? { until: str("until") } : {}), by: staff.name }) }, { status: 201 });
      case "stage_drift":
        if (!str("kitchen") || !str("family")) throw new DockError(400, "invalid_request", "Name the kitchen and the recurring order's family.");
        return Response.json({ stage: await stageDrift(rt, { kitchen: str("kitchen"), family: str("family"), cost: body.cost === true, by: staff.name }) }, { status: 201 });
      case "lift":
        return Response.json({ stage: await liftStage(rt, str("stageId"), staff.name) });
      case "claim": {
        const token = await findingClaim(rt, str("findingId"));
        if (!token) throw new DockError(404, "claim_not_found", "That finding has no signed claim.");
        return Response.json({ token });
      }
      default:
        throw new DockError(400, "invalid_request", 'action must be "run", "stage_stock_out", "stage_drift", "lift" or "claim".');
    }
  });
}
