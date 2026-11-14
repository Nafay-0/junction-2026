import { authenticate, handle, readJson } from "@/server/http";
import { findAlternatives } from "@/server/lookup";

/**
 * POST /api/v1/alternatives: what can stand in for a product inside the mandate, ranked best, better, good, each with
 * its trade-offs, live price and delivery, and the gate's own preview. The same as the MCP tool find_alternatives.
 */
export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    return Response.json(await findAlternatives(dock, session, await readJson(req)));
  });
}
