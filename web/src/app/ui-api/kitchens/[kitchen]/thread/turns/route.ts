import { readJson, MAX_JSON_BYTES } from "@/server/http";
import { noStore, portalRoute } from "@/server/kitchen-portal-http";
import { submitTurn } from "@/server/thread/engine";

/**
 * POST /ui-api/kitchens/{kitchen}/thread/turns { door, via, text?, action?, label?, clientTurnId? }
 * One buyer turn: words (typed or a transcript) or a tap on a card. Answers 202 at once with the turn ids; the
 * agent's work arrives on the event stream (docs/agent-thread.md).
 */
export async function POST(req: Request, ctx: RouteContext<"/ui-api/kitchens/[kitchen]/thread/turns">) {
  return portalRoute(req, ctx.params, async (k) => {
    const body = await readJson(req, MAX_JSON_BYTES);
    const reply = await submitTurn(k, body);
    return Response.json(reply, { status: reply.duplicate ? 200 : 202, ...noStore });
  });
}
