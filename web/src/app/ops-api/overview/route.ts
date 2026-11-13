import { opsRoute } from "@/server/ops/handler";
import { overview } from "@/server/ops/views";

/** GET /ops-api/overview: the agents at the door, every request as a session row, the counters and the chain. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => Response.json(await overview(rt)));
}
