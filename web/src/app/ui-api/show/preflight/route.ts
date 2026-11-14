import { requestOrigin } from "@/server/config";
import { optionalId, showRoute } from "@/server/show/http";
import { preflight, showSpend } from "@/server/show/preflight";

/** GET ?sandboxId=&model=1: every dependency of the three minutes, each with what is wrong and how to fix it. */
export async function GET(req: Request) {
  return showRoute(req, async (rt) => {
    const q = new URL(req.url).searchParams;
    const checks = await preflight(rt, { sandboxId: optionalId(q.get("sandboxId")), model: q.get("model") === "1", origin: requestOrigin(req) });
    return Response.json({ checks, spend: showSpend(rt), at: new Date().toISOString() });
  });
}
