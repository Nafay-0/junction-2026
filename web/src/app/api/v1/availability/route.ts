import { authenticate, handle, readJson } from "@/server/http";

/**
 * POST /api/v1/availability. Offers carry the ids of their signed claims; `unavailable` says why the other
 * products cannot be quoted (a passed order cut-off, a sales block, no price); with `includeClaims: true` the
 * signed claims come back as compact JWS tokens to verify offline against /api/v1/keys.
 */
export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const r = await dock.lookupAvailability(session, (await readJson(req)) as never);
    return Response.json({ ...r, liveCallsSoFar: dock.stats().liveCalls });
  });
}
