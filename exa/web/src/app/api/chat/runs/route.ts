import { requireUser } from "@/lib/auth/server";
import type { RunList } from "@/lib/run-state";
import { runsOf } from "@/lib/runs";

export const dynamic = "force-dynamic";

/** The conversations of this account that have a task running right now, for the list beside the chat. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const list: RunList = { running: runsOf(user.id).map((run) => ({ id: run.conversationId, startedAt: run.startedAt })) };
  return Response.json(list);
}
