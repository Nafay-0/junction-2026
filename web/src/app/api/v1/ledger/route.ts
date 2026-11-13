import { explain } from "@/core/ledger";
import { handle } from "@/server/http";

/** GET /api/v1/ledger?requestId=...&orderId=... The chain is always verified in full; the filter only narrows what is returned. */
export async function GET(req: Request) {
  return handle(async ({ dock }) => {
    const p = new URL(req.url).searchParams;
    const entries = dock.ledger.entries({ requestId: p.get("requestId") ?? undefined, orderId: p.get("orderId") ?? undefined });
    return Response.json({ verification: dock.ledger.verify(), head: dock.ledger.head(), catalog: dock.stats(), explanation: explain(entries), entries });
  });
}
