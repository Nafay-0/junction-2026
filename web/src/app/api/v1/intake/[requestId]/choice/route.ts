import { humanViaOf } from "@/server/console-context";
import { authenticate, handle, readJson } from "@/server/http";

/** POST /api/v1/intake/{requestId}/choice  { by, optionId }: the wholesaler quotes the chosen option. */
export async function POST(req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const { requestId } = await ctx.params;
    return Response.json({ step: await dock.intake.choose(session, requestId, (await readJson(req)) as never, humanViaOf(req)) });
  });
}
