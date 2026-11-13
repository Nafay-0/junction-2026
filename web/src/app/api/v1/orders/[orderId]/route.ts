import { authenticate, handle } from "@/server/http";

export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const { orderId } = await ctx.params;
    return Response.json({ order: await dock.getOrder(session, orderId) });
  });
}
