import { createHash } from "node:crypto";
import { readJson, MAX_JSON_BYTES } from "@/server/http";
import { ACCOUNT_COOKIE } from "@/server/accounts/http";
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
    // The browser session, as a hash of its sign-in cookie (never the cookie): who opened what in a shared kitchen.
    const cookie = /(?:^|;\s*)([^=;]+)=([^;]*)/g;
    let token = "";
    for (const m of (req.headers.get("cookie") ?? "").matchAll(cookie)) if (m[1] === ACCOUNT_COOKIE) token = m[2];
    const visitor = token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : undefined;
    const reply = await submitTurn(k, body, { ...(visitor ? { visitor } : {}) });
    return Response.json(reply, { status: reply.duplicate ? 200 : 202, ...noStore });
  });
}
