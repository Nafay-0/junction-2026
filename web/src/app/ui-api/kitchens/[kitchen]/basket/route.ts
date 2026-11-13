import { errorBody } from "@/server/http";
import { basketQuote } from "@/server/kitchen-portal";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/**
 * POST /ui-api/kitchens/{kitchen}/basket { lines: [{ productId, packs }], deliverBy? }
 * The buyer's own basket: Dock opens a request and the wholesaler fixes a price. The order itself is then
 * POST /api/v1/orders through the console's call route, the same gate an agent's order goes through.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/basket">) {
  return portalRoute(req, ctx.params, async (k) => {
    const body = (await req.json().catch(() => ({}))) as { lines?: unknown; deliverBy?: unknown };
    const lines = (Array.isArray(body.lines) ? body.lines : [])
      .map((l) => l as { productId?: unknown; packs?: unknown })
      .filter((l) => typeof l.productId === "string" && typeof l.packs === "number" && l.packs > 0 && l.packs <= 10_000)
      .map((l) => ({ productId: l.productId as string, packs: l.packs as number }));
    if (lines.length === 0 || lines.length > 10) return Response.json(errorBody("invalid_request", "Send 1 to 10 basket lines, each { productId, packs }."), { status: 400 });
    const deliverBy = typeof body.deliverBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.deliverBy) ? body.deliverBy : undefined;
    const r = await basketQuote(k, lines, deliverBy);
    return Response.json(r.json, { status: r.status, ...noStore });
  });
}
