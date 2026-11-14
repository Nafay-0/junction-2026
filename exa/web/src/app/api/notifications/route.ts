import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { deleteNotifications, listNotifications, markRead } from "@/lib/db/notifications";
import type { NotificationList } from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

const ReadBody = z.object({
  action: z.literal("read"),
  ids: z.union([z.literal("all"), z.array(z.uuid()).max(200)]),
});

/** The account's latest notifications, newest first, and how many it has not read. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const list: NotificationList = await listNotifications(user.id);
  return Response.json(list, { headers: { "cache-control": "no-store" } });
}

/** Mark some, or all, as read. Answers with the list as it then stands. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = ReadBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "That request was not understood." }, { status: 400 });
  await markRead(user.id, body.data.ids);
  const list: NotificationList = await listNotifications(user.id);
  return Response.json(list);
}

/** Remove notifications: the one named by `?id=`, or all of them. */
export async function DELETE(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = new URL(req.url).searchParams.get("id");
  if (id !== null && !z.uuid().safeParse(id).success) return Response.json({ error: "There is no such notification." }, { status: 404 });
  await deleteNotifications(user.id, id ?? undefined);
  const list: NotificationList = await listNotifications(user.id);
  return Response.json(list);
}
