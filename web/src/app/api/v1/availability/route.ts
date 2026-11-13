import { authenticate, handle, readJson } from "@/server/http";

export async function POST(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    const offers = await dock.checkAvailability(session, (await readJson(req)) as never);
    return Response.json({ offers, liveCallsSoFar: dock.stats().liveCalls });
  });
}
