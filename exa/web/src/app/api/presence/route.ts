import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { listNotifications } from "@/lib/db/notifications";
import type { NotificationList } from "@/lib/notifications/types";
import { checkIn } from "@/lib/presence";

export const dynamic = "force-dynamic";

const Body = z.object({
  /** Tells this window apart from the account's other ones. Made up by the page when it loads. */
  windowId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  /** True while the window is visible and has the focus. */
  here: z.boolean(),
});

/**
 * A window says whether it is in front of its user. The server uses that for one thing: someone
 * who has Beryl open is not sent an email about what they can see there. The answer carries the
 * latest notifications, so the same request keeps the bell up to date.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "That request was not understood." }, { status: 400 });
  checkIn(user.id, body.data.windowId, body.data.here);
  // A window that is leaving has no use for the list.
  if (!body.data.here) return new Response(null, { status: 204 });
  const list: NotificationList = await listNotifications(user.id);
  return Response.json(list, { headers: { "cache-control": "no-store" } });
}
