import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { validConversationId } from "@/lib/db/conversations";
import { setNotifyWhenDone, wantsNotifyWhenDone } from "@/lib/db/notifications";
import { activeRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const Body = z.object({ on: z.boolean() });

/** What `/api/chat/[id]/notify` answers. */
export type NotifyWhenDone = {
  /** The user has asked to be told when this chat is done. */
  on: boolean;
  /** How long the request in progress has been going, in milliseconds. Absent when nothing is running on the server. */
  workingForMs?: number;
};

/** Has the user asked to be told when this chat is done, and how long has it been working? */
export async function GET(_req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!validConversationId(id)) return Response.json({ on: false } satisfies NotifyWhenDone);
  const run = activeRun(user.id, id);
  const state: NotifyWhenDone = { on: await wantsNotifyWhenDone(user.id, id), workingForMs: run ? Date.now() - run.startedAt : undefined };
  return Response.json(state, { headers: { "cache-control": "no-store" } });
}

/** "Tell me when it's done", or taking that back. The chat has to be one of the account's own. */
export async function POST(req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "That request was not understood." }, { status: 400 });
  const found = validConversationId(id) && (await setNotifyWhenDone(user.id, id, body.data.on));
  if (!found) return Response.json({ error: "There is no such chat." }, { status: 404 });
  return Response.json({ on: body.data.on } satisfies NotifyWhenDone);
}
