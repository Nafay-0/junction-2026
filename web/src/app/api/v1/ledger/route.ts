import { auditFor } from "@/core/audit";
import { handle } from "@/server/http";

/**
 * GET /api/v1/ledger?requestId=...&orderId=...&view=buyer|wholesaler
 * The chain is always verified in full; the filter only narrows what is returned. `view=wholesaler` gives the
 * wholesaler's reading of the same chain: what was asked, claimed, committed and who signed, without the buyer's
 * private kitchen memory (those entries keep only their sequence number and hash).
 */
export async function GET(req: Request) {
  return handle(async ({ dock }) => {
    const p = new URL(req.url).searchParams;
    const entries = dock.ledger.entries({ requestId: p.get("requestId") ?? undefined, orderId: p.get("orderId") ?? undefined });
    const audit = auditFor(p.get("view") === "wholesaler" ? "wholesaler" : "buyer", entries);
    return Response.json({ verification: dock.ledger.verify(), head: dock.ledger.head(), catalog: dock.stats(), view: audit.view, explanation: audit.explanation, entries: audit.entries });
  });
}
