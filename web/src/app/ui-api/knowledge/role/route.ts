import { errorBody } from "@/server/http";
import { RoleQuery, constraintsOf, productsForRole } from "@/server/knowledge/service";

/**
 * GET /ui-api/knowledge/role?q=cream for carbonara[&claims=lactose_free][&allergens=nuts][&limit=6]
 *
 * Products that fit an ingredient's role in a dish, from free text: the uses read from the dish words, the kinds
 * from the ingredient words, products ranked by fit, the buyer's constraints checked against the data.
 */
export async function GET(req: Request) {
  const q = RoleQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return Response.json(errorBody("invalid_query", q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")), { status: 400 });
  const r = await productsForRole(q.data.q, { constraints: constraintsOf(q.data), limit: q.data.limit });
  if ("unknownConstraints" in r) return Response.json(errorBody("constraint_unknown", r.reason, undefined, { unknown: r.unknownConstraints }), { status: 400 });
  if (!r.available) return Response.json(errorBody("knowledge_unavailable", r.reason), { status: 503 });
  return Response.json(r, { headers: { "cache-control": "no-store" } });
}
