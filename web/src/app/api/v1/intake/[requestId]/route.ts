import { authenticate, handle } from "@/server/http";

/** GET /api/v1/intake/{requestId}: the current step. */
export async function GET(req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const { requestId } = await ctx.params;
    return Response.json({ step: await dock.intake.get(session, requestId) });
  });
}
