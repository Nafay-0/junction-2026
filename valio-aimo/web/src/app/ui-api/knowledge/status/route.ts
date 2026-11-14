import { knowledgeStatus } from "@/server/knowledge/service";

/** GET /ui-api/knowledge/status: whether the knowledge map is loaded, from where, how big, built when and by which model. */
export async function GET(req: Request) {
  void req.url; // request-time route
  return Response.json(await knowledgeStatus(), { headers: { "cache-control": "no-store" } });
}
