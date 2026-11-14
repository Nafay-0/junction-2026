import { handle } from "@/server/http";
import { restOffer } from "@/server/offers/rest";

/** POST /api/v1/offers/mute { scope: product | family | reason | all, offerId?, value?, undo?, by? }. */
export async function POST(req: Request) {
  return handle(async (rt) => Response.json(await restOffer(rt, req, "mute_offers", {}, { body: true })));
}
