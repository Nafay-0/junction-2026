import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { clientKindOf } from "@/lib/client-kind";
import { deleteConversation, getConversation, renameConversation, saveConversation, validConversationId } from "@/lib/db/conversations";
import { readOnlyReason } from "@/lib/db/origin";

export const dynamic = "force-dynamic";

/** A conversation with attached pictures can be large, but not this large. */
const MAX_BYTES = 40 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

const refuse = (status: number, error: string) => Response.json({ error }, { status });
const NOT_FOUND = "There is no such conversation.";

const SaveBody = z.object({
  title: z.string().max(400).default(""),
  modelLabel: z.string().max(80).nullish(),
  messages: z.array(z.looseObject({ id: z.string(), role: z.string() })).min(1),
});

const RenameBody = z.object({ title: z.string().trim().min(1).max(400) });

/** One conversation with its messages. Someone else's id is a 404, like one that does not exist. */
export async function GET(_req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const found = validConversationId(id) ? await getConversation(user.id, id) : null;
  return found ? Response.json(found) : refuse(404, NOT_FOUND);
}

/**
 * Save the whole message list. The first save creates the conversation and marks where it was
 * started (the web or the desktop app); after that only that kind of client may add to it.
 */
export async function PUT(req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!validConversationId(id)) return refuse(400, "That is not a conversation id.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return refuse(413, "This conversation is too large to save.");

  const parsed = SaveBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse(400, "There is nothing to save.");
  const result = await saveConversation(user.id, id, clientKindOf(req), parsed.data);
  return result.saved ? Response.json({ meta: result.meta }) : refuse(409, readOnlyReason(result.origin));
}

/** Rename. Allowed from either kind of client. */
export async function PATCH(req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const parsed = RenameBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse(400, "Give the conversation a name.");
  const meta = validConversationId(id) ? await renameConversation(user.id, id, parsed.data.title) : null;
  return meta ? Response.json({ meta }) : refuse(404, NOT_FOUND);
}

/** Delete. Allowed from either kind of client. Deleting what is already gone is not an error. */
export async function DELETE(_req: Request, { params }: Context) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const deleted = validConversationId(id) ? await deleteConversation(user.id, id) : false;
  return Response.json({ deleted });
}
