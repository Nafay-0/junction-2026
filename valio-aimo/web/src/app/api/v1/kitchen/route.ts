import { authenticate, handle } from "@/server/http";

/** GET /api/v1/kitchen: what Dock remembers about the agent's kitchen (history, stated and learned preferences). */
export async function GET(req: Request) {
  return handle(async ({ dock }) => {
    const session = await authenticate(req, dock);
    return Response.json({ kitchen: await dock.intake.kitchen(session) });
  });
}
