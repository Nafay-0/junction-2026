import { humanViaOf } from "@/server/console-context";
import { authenticate, handle, readJson } from "@/server/http";
import { restStep } from "@/server/rest-step";

/** POST /api/v1/intake/{requestId}/concerns  { by, responses: [{ key, choice: "confirm" | correctionId }] } */
export async function POST(req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const { requestId } = await ctx.params;
    return Response.json(restStep(req, session, await dock.intake.respondToConcerns(session, requestId, (await readJson(req)) as never, humanViaOf(req))));
  });
}
