import { conversationList } from "@/server/ops/conversation";
import { opsRoute } from "@/server/ops/handler";

/** GET /ops-api/conversation: the latest conversations between kitchens and their agents, newest first. */
export async function GET(req: Request) {
  return opsRoute(req, async (rt) => Response.json({ conversations: conversationList(rt) }));
}
