import { readJson } from "@/server/http";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { rulesSignOff } from "@/server/thread/engine";

/**
 * POST /ui-api/kitchens/{kitchen}/rules/{proposalId} { proof: { kind: "webauthn", response } }: the named approver's
 * passkey signature over a change that widens what the agent may do. Verified by the same verifier as an order's
 * sign-off (single-use challenge, this approver's credential, this exact change); only then is the change signed.
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/rules/[proposalId]">) {
  return portalRoute(req, ctx.params, async (k) => {
    const { proposalId } = await ctx.params;
    const body = (await readJson(req)) as { proof?: unknown };
    const r = await rulesSignOff(k, proposalId, body.proof);
    return Response.json(r, noStore);
  });
}
