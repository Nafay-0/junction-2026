import { requireUser } from "@/lib/auth/server";
import { validConversationId } from "@/lib/db/conversations";
import type { RunState } from "@/lib/run-state";
import { activeRun, stopRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Is a task running in this conversation? If so, the answer carries the conversation as it was
 * when the task began: the interface starts from that and replays the task's stream on top, so
 * what it shows is exactly what happened, whatever was saved in between.
 */
export async function GET(_req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const run = validConversationId(id) ? activeRun(user.id, id) : undefined;
  const state: RunState = run ? { active: true, startedAt: run.startedAt, messages: run.original } : { active: false };
  return Response.json(state);
}

/** Stop the task running in this conversation. This is the Stop button: closing the page is not. */
export async function DELETE(_req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  return Response.json({ stopped: validConversationId(id) ? stopRun(user.id, id) : false });
}
