import { handle } from "@/server/http";
import { withKitchen } from "../../../_shared";

/** POST /ui-api/plan/{kitchen}/{planId}/quote: the whole plan as one fixed-price quote, each line explained in the ledger. */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]/[planId]/quote">) {
  return handle(async () => {
    const { kitchen: slug, planId } = await ctx.params;
    const { service, kitchen, reply } = await withKitchen(slug, req);
    return reply(await service.quote(kitchen, planId, kitchen.info.by));
  });
}
