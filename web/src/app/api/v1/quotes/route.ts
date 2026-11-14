import { authenticate, handle, readJson } from "@/server/http";
import { nextStepForQuote } from "@/server/mcp/next-step";

export async function POST(req: Request) {
  return handle(async (rt) => {
    const { dock } = rt;
    const session = await authenticate(req, dock);
    const result = await dock.requestQuote(session, (await readJson(req)) as never);
    const { withDeliveryRecords } = await import("@/server/reliability/service");
    return Response.json(await withDeliveryRecords(rt, session.mandate.issuer.orgId, { ...result, nextStep: nextStepForQuote(result.policyPreview, "rest") }), { status: 201 });
  });
}
