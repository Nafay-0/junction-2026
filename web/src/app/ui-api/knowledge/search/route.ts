import { z } from "zod";
import { errorBody } from "@/server/http";
import { getKnowledgeMap, knowledgeStatus } from "@/server/knowledge/service";

const Query = z.object({ q: z.string().min(2).max(120), limit: z.coerce.number().int().min(1).max(30).optional() });

/** GET /ui-api/knowledge/search?q=whipping cream: products by name with their kind and uses, for the preview's picker. */
export async function GET(req: Request) {
  const q = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return Response.json(errorBody("invalid_query", "q: 2 to 120 characters"), { status: 400 });
  const map = await getKnowledgeMap();
  if (!map) return Response.json(errorBody("knowledge_unavailable", ((await knowledgeStatus()) as { reason: string }).reason), { status: 503 });
  return Response.json({ products: map.find(q.data.q, q.data.limit ?? 12) }, { headers: { "cache-control": "no-store" } });
}
