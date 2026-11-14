import { conversationView } from "@/server/ops/conversation";
import { opsRead } from "@/server/ops/handler";
import { WORDS_HIDDEN } from "@/server/ops/viewer";

/** GET /ops-api/conversation/{threadId}: one kitchen's conversation with its agent, turn by turn, from the ledger. */
export async function GET(req: Request, ctx: RouteContext<"/ops-api/conversation/[threadId]">) {
  const { threadId } = await ctx.params;
  return opsRead(req, async (rt, _who, scope) => {
    const v = await conversationView(rt, threadId);
    // Someone's own kitchen: a viewer sees that the conversation happened, its turns and outcomes, not its words.
    if (scope && v.orgId && scope.privateOrgs.has(v.orgId)) {
      return Response.json({
        ...v,
        wordsHidden: WORDS_HIDDEN,
        turns: v.turns.map((t) => ({ ...t, ...(t.said !== undefined ? { said: WORDS_HIDDEN } : {}), ...(t.tapped !== undefined ? { tapped: "a tap" } : {}), entries: t.entries.map((e) => ({ ...e, summary: e.event ? `${e.type}: ${e.event.replaceAll("_", " ")} (${WORDS_HIDDEN})` : WORDS_HIDDEN })) })),
      });
    }
    return Response.json(v);
  });
}
