import { handle } from "@/server/http";
import { restOffer } from "@/server/offers/rest";

/** POST /api/v1/offers/{offerId}/decline { by? }: not wanted; not offered again for 30 days. */
export async function POST(req: Request, ctx: { params: Promise<{ offerId: string }> }) {
  return handle(async (rt) => {
    const { offerId } = await ctx.params;
    return Response.json(await restOffer(rt, req, "decline_offer", { offerId }, { body: true }));
  });
}
