import { errorBody } from "@/server/http";
import { getKnowledgeMap, knowledgeStatus } from "@/server/knowledge/service";
import { USE_TEXT } from "@/server/knowledge/vocab";

/**
 * GET /ui-api/knowledge/profiles?ids=463171,460396
 *
 * Read-only, for the store's product tiles: each product's kind ("skimmed milk") and the kitchen uses it fits, in
 * words, from the knowledge map. At most 100 ids; unknown ids are left out. Master data only, no live call.
 */
export async function GET(req: Request) {
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 100);
  const map = await getKnowledgeMap();
  if (!map) return Response.json(errorBody("knowledge_unavailable", ((await knowledgeStatus()) as { reason?: string }).reason ?? "The knowledge map is not loaded."), { status: 503 });
  const profiles: Record<string, { kind: string; uses: { id: string; text: string }[] }> = {};
  for (const id of ids) {
    const p = map.profile(id);
    if (p) profiles[id] = { kind: p.kindLabel, uses: p.uses.filter((u) => u !== "non_food").map((u) => ({ id: u, text: USE_TEXT[u] ?? u.replaceAll("_", " ") })) };
  }
  return Response.json({ profiles }, { headers: { "cache-control": "private, max-age=300" } });
}
