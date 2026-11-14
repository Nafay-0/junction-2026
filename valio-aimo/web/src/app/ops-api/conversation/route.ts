import { conversationList } from "@/server/ops/conversation";
import { opsRead } from "@/server/ops/handler";

/** GET /ops-api/conversation: the latest conversations between kitchens and their agents, newest first. */
export async function GET(req: Request) {
  return opsRead(req, async (rt) => Response.json({ conversations: conversationList(rt) }));
}
