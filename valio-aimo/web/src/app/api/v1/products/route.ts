import { authenticate, handle } from "@/server/http";

/** Master-data search: GET /api/v1/products?requestId=...&q=milk&category=milk&attribute=lactose_free&limit=10 */
export async function GET(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const p = new URL(req.url).searchParams;
    const limit = p.get("limit");
    const products = await dock.searchProducts(session, {
      requestId: p.get("requestId") ?? "",
      text: p.get("q") ?? undefined,
      category: p.get("category") ?? undefined,
      attributes: p.getAll("attribute").length ? p.getAll("attribute") : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return Response.json({ products, liveCallsSoFar: dock.stats().liveCalls });
  });
}
