import { getRuntime } from "@/server/runtime";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";

/**
 * GET /ui-api/kitchens/{kitchen}/claims?id=clm_...&id=...: the wholesaler-signed claims (price, availability,
 * origin) Dock issued to this kitchen, as compact JWS tokens, so the order page can check them in the browser
 * against the keys at /api/v1/keys. At most 30 ids.
 */
export async function GET(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/claims">) {
  return portalRoute(req, ctx.params, async (k) => {
    const ids = new URL(req.url).searchParams.getAll("id").filter((x) => x.length > 0 && x.length < 80).slice(0, 30);
    const { dock } = await getRuntime();
    const session = await dock.authenticate(k.mandateToken, k.agentId);
    const claims = ids.length ? await dock.getClaims(session, ids) : [];
    return Response.json({ claims: claims.map(({ claimId, type, productId, sha256, token, validUntil }) => ({ claimId, type, productId, sha256, token, validUntil })) }, noStore);
  });
}
