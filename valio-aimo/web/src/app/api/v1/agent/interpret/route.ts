import { isDockError, parse } from "@/core/errors";
import { InterpretBody, interpretRequest } from "@/server/agent/interpret";
import { consoleContextOf } from "@/server/console-context";
import { authenticate, errorBody, handle, readJson } from "@/server/http";
import { cacheKey, cachedInterpretation, quotaHeaders, rememberInterpretation, takeInterpretCall } from "@/server/interpret-quota";

/**
 * POST /api/v1/agent/interpret  { text }  ->  200 { need, model, ms }
 * Free text (English, Finnish or Swedish) to the structured need that POST /api/v1/intake takes. Only what
 * the buyer said is filled in. Errors: 422 not_a_purchase_request / need_incomplete (details.missing,
 * details.partial), 429 interpret_quota_exceeded, 502 interpret_failed / interpret_invalid_output,
 * 503 model_unavailable, 504 interpret_timeout.
 *
 * Each caller (an on-site console session, or an outside agent) has an hourly allowance of model calls; the same
 * text for the same kitchen on the same day is answered from a cache for free (server/interpret-quota.ts).
 */
export async function POST(req: Request) {
  return handle(async ({ dock, catalog }) => {
    const session = await authenticate(req, dock);
    const body = parse(InterpretBody, await readJson(req));
    const consoleCtx = consoleContextOf(req);
    const caller = consoleCtx ? `console:${consoleCtx.kitchen}:${consoleCtx.session}` : `agent:${session.mandate.issuer.orgId}:${session.agentId}`;
    const { key, day } = cacheKey(session.mandate.issuer.orgId, body);
    const hit = cachedInterpretation(key, day);
    if (hit) return Response.json({ ...(hit as object), cached: true }, { headers: quotaHeaders(caller) });
    let headers: Record<string, string>;
    try {
      headers = takeInterpretCall(caller);
    } catch (err) {
      if (isDockError(err)) return Response.json(errorBody(err.code, err.message, err.rule, err.details), { status: err.status, headers: (err as unknown as { headers?: Record<string, string> }).headers });
      throw err;
    }
    const out = await interpretRequest(body, { catalog, mandate: session.mandate, door: session.door });
    rememberInterpretation(key, day, out);
    return Response.json(out, { headers });
  });
}
