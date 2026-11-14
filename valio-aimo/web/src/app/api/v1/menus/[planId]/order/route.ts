import { handle } from "@/server/http";
import { restMenu } from "@/server/agent/menu/rest";

/** POST /api/v1/menus/{planId}/order { choices?, by? }: one signed quote for the plan's lines, placed through the gate. */
export async function POST(req: Request, ctx: { params: Promise<{ planId: string }> }) {
  return handle(async (rt) => {
    const { planId } = await ctx.params;
    return Response.json(await restMenu(rt, req, "order_menu", { planId }), { status: 201 });
  });
}
