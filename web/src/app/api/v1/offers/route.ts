import { handle } from "@/server/http";
import { restOffer } from "@/server/offers/rest";

/** GET /api/v1/offers[?all=true]: the wholesaler's signed offers to this kitchen (open ones by default). */
export async function GET(req: Request) {
  return handle(async (rt) => Response.json(await restOffer(rt, req, "list_offers", new URL(req.url).searchParams.get("all") === "true" ? { all: true } : {})));
}
