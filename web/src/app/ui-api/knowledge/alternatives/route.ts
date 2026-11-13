import { errorBody } from "@/server/http";
import { AlternativesQuery, alternativesFor, constraintsOf } from "@/server/knowledge/service";

/**
 * GET /ui-api/knowledge/alternatives?product=<id>[&use=sauce][&claims=lactose_free,vegan][&allergens=nuts][&max=5][&debug=1]
 *
 * Ranked substitutes (good, better, best) for one product in one use, each with what changes and any condition,
 * checked against the product data and the buyer's constraints; pack alternatives apart; `none` when there is no
 * substitute and why. `debug=1` also lists what was considered and dropped.
 */
export async function GET(req: Request) {
  const q = AlternativesQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return Response.json(errorBody("invalid_query", q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")), { status: 400 });
  const r = await alternativesFor(q.data.product, { use: q.data.use, constraints: constraintsOf(q.data), max: q.data.max, debug: !!q.data.debug });
  if (!r.available) return Response.json(errorBody("knowledge_unavailable", r.reason), { status: 503 });
  if ("unknownProduct" in r) return Response.json(errorBody("product_not_found", `${r.unknownProduct} is not in the catalogue.`), { status: 404 });
  return Response.json(r, { headers: { "cache-control": "no-store" } });
}
