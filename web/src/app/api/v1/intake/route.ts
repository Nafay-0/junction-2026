import { authenticate, handle, readJson } from "@/server/http";

/**
 * POST /api/v1/intake  { need: StructuredNeed, by? }
 * Start from a structured need. The reply is a typed step: needs_confirmation, needs_input, options_ready,
 * quoted, no_options or cancelled, with `next` naming the call to make.
 */
export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const step = await dock.intake.open(session, (await readJson(req)) as never);
    return Response.json({ step }, { status: 201 });
  });
}
