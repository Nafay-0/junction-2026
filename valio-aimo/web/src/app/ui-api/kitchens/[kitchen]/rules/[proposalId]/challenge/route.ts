import { relyingParty } from "@/server/config";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { rulesSignOffOptions } from "@/server/thread/engine";

/**
 * POST /ui-api/kitchens/{kitchen}/rules/{proposalId}/challenge -> { options } for startAuthentication(): the passkey
 * prompt for a change to the kitchen's rules that widens what its agent may do, bound to that exact change, the
 * mandate it changes and a fresh single-use nonce (the same ceremony as an order's sign-off).
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/rules/[proposalId]/challenge">) {
  return portalRoute(req, ctx.params, async (k) => {
    const { proposalId } = await ctx.params;
    const options = await rulesSignOffOptions(k, proposalId, relyingParty(req));
    return Response.json({ options }, noStore);
  });
}
