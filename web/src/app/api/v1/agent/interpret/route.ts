import { parse } from "@/core/errors";
import { InterpretBody, interpretRequest } from "@/server/agent/interpret";
import { authenticate, handle, readJson } from "@/server/http";

/**
 * POST /api/v1/agent/interpret  { text }  ->  200 { need, model, ms }
 * Free text (English, Finnish or Swedish) to the structured need that POST /api/v1/intake takes. Only what
 * the buyer said is filled in. Errors: 422 not_a_purchase_request / need_incomplete (details.missing,
 * details.partial), 502 interpret_failed / interpret_invalid_output, 503 model_unavailable, 504 interpret_timeout.
 */
export async function POST(req: Request) {
  return handle(async ({ dock, catalog }) => {
    const session = await authenticate(req, dock);
    const body = parse(InterpretBody, await readJson(req));
    return Response.json(await interpretRequest(body, { catalog, mandate: session.mandate }));
  });
}
