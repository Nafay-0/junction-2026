import { requireUser } from "@/lib/auth/server";
import { deleteAllConversations, listConversations } from "@/lib/db/conversations";

export const dynamic = "force-dynamic";

/** The signed-in account's conversations, newest first, without their messages. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return Response.json({ conversations: await listConversations(user.id) });
}

/** Delete every conversation of the signed-in account. */
export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return Response.json({ deleted: await deleteAllConversations(user.id) });
}
