import { createUIMessageStreamResponse } from "ai";
import { requireUser } from "@/lib/auth/server";
import { validConversationId } from "@/lib/db/conversations";
import { RUN_GONE_CODE } from "@/lib/run-state";
import { activeRun, follow } from "@/lib/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

type Context = { params: Promise<{ id: string }> };

/**
 * Join the task that is running in this conversation: everything it has streamed so far, then
 * the rest as it happens. Leaving again does not stop the task.
 *
 * The interface asks with a POST, the way it asks for a fresh answer, so the replay is put
 * together exactly as the answer was the first time (it starts from the conversation as the task
 * found it, which `/api/chat/[id]/run` hands out). When the task has ended in the meantime the
 * answer is 409 with `run_gone`, and the interface loads the saved conversation instead.
 */
export async function POST(_req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const run = validConversationId(id) ? activeRun(user.id, id) : undefined;
  if (!run) return Response.json({ error: "That task has finished.", code: RUN_GONE_CODE }, { status: 409 });
  return createUIMessageStreamResponse({ stream: follow(run) });
}

/** The same stream for a plain GET, which is where the AI SDK's own reconnect looks. 204 when nothing is running. */
export async function GET(_req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const run = validConversationId(id) ? activeRun(user.id, id) : undefined;
  if (!run) return new Response(null, { status: 204 });
  return createUIMessageStreamResponse({ stream: follow(run) });
}
