import { opsRead } from "@/server/ops/handler";
import { safeguards } from "@/server/ops/views";

/** GET /ops-api/safeguards: the rule book with how often each rule fired, the refused attempts and the live-service limits. */
export async function GET(req: Request) {
  return opsRead(req, async (rt) => Response.json(await safeguards(rt)));
}
