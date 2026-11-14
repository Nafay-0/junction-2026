import { authenticate, handle } from "@/server/http";
import { restOrder } from "@/server/rest-step";

export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const { orderId } = await ctx.params;
    return Response.json(restOrder(await dock.getOrder(session, orderId)));
  });
}
