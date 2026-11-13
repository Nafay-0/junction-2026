import { auditFor } from "@/core/audit";
import { principalOf, readableEntries } from "@/server/authz";
import { handle } from "@/server/http";

/**
 * GET /api/v1/ledger?requestId=...&orderId=...&view=buyer|wholesaler
 * The chain is always verified in full, and its verification and head are public: anyone can check it. Entries are
 * not: an agent (its mandate) or an approver (their signed-in phone) reads its own organisation's entries, the
 * operations desk reads everyone's, a stranger reads none (server/authz.ts). The filter only narrows what is
 * returned. `view=wholesaler` gives the wholesaler's reading of the same chain: what was asked, claimed, committed
 * and who signed, without the buyer's private kitchen memory (those entries keep only their sequence number and hash).
 */
export async function GET(req: Request) {
  return handle(async (rt) => {
    const { dock } = rt;
    const p = new URL(req.url).searchParams;
    const who = await principalOf(req, rt);
    const all = dock.ledger.entries({ requestId: p.get("requestId") ?? undefined, orderId: p.get("orderId") ?? undefined });
    const entries = await readableEntries(rt, who, all);
    const audit = auditFor(p.get("view") === "wholesaler" ? "wholesaler" : "buyer", entries);
    const signedIn = !!(who.ops || who.approver || who.agent);
    return Response.json({
      verification: dock.ledger.verify(),
      head: dock.ledger.head(),
      catalog: dock.stats(),
      view: audit.view,
      explanation: signedIn ? audit.explanation : ["The chain's verification and head are public; its entries are shown only to the kitchen's own agent, its approver or the wholesaler's operations desk."],
      entries: audit.entries,
    });
  });
}
