import { errorBody } from "@/server/http";
import { basketQuote, basketPlace } from "@/server/kitchen-portal";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/**
 * POST /ui-api/kitchens/{kitchen}/basket { lines: [{ productId, packs }], deliverBy? }
 * The buyer's own basket: Dock opens a request and the wholesaler fixes a price. The order itself is then
 * POST /api/v1/orders through the console's call route, the same gate an agent's order goes through.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/basket">) {
  return portalRoute(req, ctx.params, async (k) => {
    const body = (await req.json().catch(() => ({}))) as { lines?: unknown; deliverBy?: unknown; place?: { requestId?: unknown; quoteToken?: unknown; lines?: unknown; confirm?: unknown } };
    // { place: { requestId, quoteToken, lines, confirm? } }: send the quoted basket to the gate, with the mistake
    // check's concerns the person at the screen confirmed (server/kitchen-portal.ts basketPlace).
    if (body.place && typeof body.place === "object") {
      const p = body.place;
      const orderLines = (Array.isArray(p.lines) ? p.lines : []).filter((l): l is { productId: string; quantity: number; unitPriceCents: number } => !!l && typeof (l as { productId?: unknown }).productId === "string" && typeof (l as { quantity?: unknown }).quantity === "number" && typeof (l as { unitPriceCents?: unknown }).unitPriceCents === "number");
      if (typeof p.requestId !== "string" || typeof p.quoteToken !== "string" || !orderLines.length) return Response.json(errorBody("invalid_request", "Send place: { requestId, quoteToken, lines }."), { status: 400 });
      const confirm = Array.isArray(p.confirm) ? p.confirm.filter((x): x is string => typeof x === "string").slice(0, 20) : undefined;
      const placed = await basketPlace(k, { requestId: p.requestId, quoteToken: p.quoteToken, lines: orderLines.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents })), confirm });
      return Response.json(placed.json, { status: placed.status, ...noStore });
    }
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
