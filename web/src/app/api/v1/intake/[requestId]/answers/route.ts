import { humanViaOf } from "@/server/console-context";
import { authenticate, handle, readJson } from "@/server/http";
import { restStep } from "@/server/rest-step";

/** POST /api/v1/intake/{requestId}/answers  { by, answers: [{ questionId, optionId, remember? }] } */
export async function POST(req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const { requestId } = await ctx.params;
    return Response.json(restStep(req, session, await dock.intake.answer(session, requestId, (await readJson(req)) as never, humanViaOf(req))));
  });
}
