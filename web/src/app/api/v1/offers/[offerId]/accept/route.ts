import type { IntakeView } from "@/core/intake";
import { handle } from "@/server/http";
import { restOffer } from "@/server/offers/rest";
import { restStep } from "@/server/rest-step";

/** POST /api/v1/offers/{offerId}/accept { packs?, deliverBy?, by? }: starts an ordinary order (an intake step). Buys nothing. */
export async function POST(req: Request, ctx: { params: Promise<{ offerId: string }> }) {
  return handle(async (rt) => {
    const { offerId } = await ctx.params;
    const out = await restOffer(rt, req, "accept_offer", { offerId }, { body: true, withSession: (session, r) => ({ offerId, ...restStep(req, session, r.step as IntakeView) }) });
    return Response.json(out, { status: 201 });
  });
}
