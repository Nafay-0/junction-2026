import { DockError } from "@/core/orders";
import { REASON_KINDS, type OfferReasonKind } from "@/core/offers";
import { readJson } from "@/server/http";
import { opsRead, opsRoute } from "@/server/ops/handler";
import { offerToken, offersView, resetKitchenOffers, runSellingAgent, startCampaign, testKitchens } from "@/server/offers/service";

/**
 * GET /ops-api/offers: what the selling agent proposed to whom, why, and what happened (answered, expired, or held
 * back by a guardrail and which), the campaigns staff started and each kitchen's outcome, what kitchens muted.
 *
 * POST /ops-api/offers, one of:
 *   { action: "run", kitchens? }                                   run the selling agent now
 *   { action: "campaign", productId, listAsNew?, claims?, reachAllowed? }   a campaign: the agent decides kitchen by kitchen
 *   { action: "reset_test", run? }                                 DEMO: the shared test kitchens' offers stop counting
 *                                                                  (weekly cap, mutes, open offers); then a run, if asked
 *   { action: "search", q }                                        products for the campaign form (master data)
 *   { action: "token", offerId }                                   one offer's signed token, to check
 * Everything is written to the ledger with the staff member's name.
 */
export async function GET(req: Request) {
  return opsRead(req, async (rt) => Response.json(await offersView(rt)));
}

export async function POST(req: Request) {
  return opsRoute(req, async (rt, staff) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
    switch (body.action) {
      case "run": {
        const kitchens = Array.isArray(body.kitchens) ? body.kitchens.filter((k): k is string => typeof k === "string").slice(0, 50) : undefined;
        return Response.json({ run: await runSellingAgent(rt, { kitchens, by: staff.name }) });
      }
      case "campaign": {
        const claims = Array.isArray(body.claims) ? body.claims.filter((c): c is OfferReasonKind => (REASON_KINDS as readonly string[]).includes(String(c))) : [];
        if (!str("productId")) throw new DockError(400, "invalid_request", "Name the product: productId.");
        return Response.json({ campaign: await startCampaign(rt, { productId: str("productId"), by: staff.name, listAsNew: body.listAsNew === true, reachAllowed: body.reachAllowed === true, claims }) }, { status: 201 });
      }
      case "reset_test": {
        const slugs = await testKitchens(rt);
        if (!slugs.length) throw new DockError(409, "no_test_kitchens", "There are no shared test kitchens on this server.");
        const reset = await resetKitchenOffers(rt, slugs, staff.name, "demo reset from the operations page");
        const run = body.run === true ? await runSellingAgent(rt, { kitchens: slugs, by: staff.name }) : undefined;
        return Response.json({ reset, ...(run ? { run } : {}) });
      }
      case "search": {
        const { findProducts } = await import("@/server/search/service");
        const q = str("q").slice(0, 120);
        const hits = q ? (await findProducts(rt.catalog, { text: q, limit: 8, noJudge: true })).hits.map((h) => h.product) : [];
        return Response.json({ products: hits.map((p) => ({ productId: p.id, name: p.name, category: p.category, packSize: p.packSize, unit: p.unit })) });
      }
      case "token": {
        const token = await offerToken(rt, str("offerId"));
        if (!token) throw new DockError(404, "offer_not_found", "No such offer.");
        return Response.json({ token });
      }
      default:
        throw new DockError(400, "invalid_request", 'action must be "run", "campaign", "reset_test", "search" or "token".');
    }
  });
}
