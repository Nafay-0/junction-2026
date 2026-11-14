import { handle } from "@/server/http";
import { withKitchen } from "../../../_shared";

/** POST /ui-api/plan/{kitchen}/{planId}/order: place the quoted plan through the gate (mandate, budget, sign-off). */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/plan/[kitchen]/[planId]/order">) {
  return handle(async () => {
    const { kitchen: slug, planId } = await ctx.params;
    const { service, kitchen, reply } = await withKitchen(slug, req);
    return reply(await service.order(kitchen, planId));
  });
}
