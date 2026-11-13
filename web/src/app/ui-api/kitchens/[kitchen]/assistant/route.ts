import { errorBody } from "@/server/http";
import { ask } from "@/server/kitchen-assistant";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/**
 * POST /ui-api/kitchens/{kitchen}/assistant { question, productId?, orderId?, screen?, history? }
 * A grounded answer about the products and the kitchen's own records, citing the records it rests on. Never
 * orders: a purchase request comes back as kind "order_request" for the staged order flow.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/assistant">) {
  return portalRoute(ctx.params, async (k) => {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined);
    const question = str(b.question, 600);
    if (!question) return Response.json(errorBody("invalid_request", "Send { question }."), { status: 400 });
    const history = Array.isArray(b.history)
      ? b.history
          .slice(-4)
          .map((h) => h as { q?: unknown; a?: unknown })
          .filter((h) => typeof h.q === "string" && typeof h.a === "string")
          .map((h) => ({ q: (h.q as string).slice(0, 400), a: (h.a as string).slice(0, 600) }))
      : [];
    return Response.json(await ask(k, { question, productId: str(b.productId, 60), orderId: str(b.orderId, 60), screen: str(b.screen, 200), history }), noStore);
  });
}
