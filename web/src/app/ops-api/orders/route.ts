import { opsRoute } from "@/server/ops/handler";
import { ordersPage } from "@/server/ops/orders-view";

/**
 * GET /ops-api/orders?kitchen=&agent=&source=&status=&day=&q=&page=: every order from every source, newest first,
 * 50 to a page, with the counts per kitchen, agent, source and status for the filters. `q` also asks the audit
 * trail in words (OpenSearch, SQL or the ledger) and keeps the orders its events name.
 */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => {
    const p = new URL(req.url).searchParams;
    const s = (k: string) => p.get(k)?.trim() || undefined;
    return Response.json(await ordersPage(rt, { kitchen: s("kitchen"), agent: s("agent"), source: s("source"), status: s("status"), day: s("day"), q: s("q")?.slice(0, 200), page: Number(s("page") ?? 1) || 1 }), { headers: { "cache-control": "no-store" } });
  });
}
