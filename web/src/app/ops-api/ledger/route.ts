import { opsRoute } from "@/server/ops/handler";
import { ledgerForCheck } from "@/server/ops/views";

/**
 * GET /ops-api/ledger: the whole hash chain for the browser to check on its own. Buyer-side intake steps (the
 * kitchen's memory) come with their content withheld and their hashes kept, so the chain still links through them.
 */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => Response.json(ledgerForCheck(rt)));
}
