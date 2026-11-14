import { authenticate, handle, readJson } from "@/server/http";
import { nextStepForQuote } from "@/server/mcp/next-step";

export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const result = await dock.requestQuote(session, (await readJson(req)) as never);
    return Response.json({ ...result, nextStep: nextStepForQuote(result.policyPreview, "rest") }, { status: 201 });
  });
}
