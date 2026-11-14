import { opsRead } from "@/server/ops/handler";
import { agentsView } from "@/server/ops/views";

/** GET /ops-api/agents: every agent that came to the gate, its licence when known, its record and what it may do. */
export async function GET(req: Request) {
  return opsRead(req, async (rt) => Response.json(await agentsView(rt)));
}
