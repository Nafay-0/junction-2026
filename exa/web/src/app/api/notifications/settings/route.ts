import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { notifyPrefs, saveNotifyPrefs } from "@/lib/db/notifications";

export const dynamic = "force-dynamic";

const Change = z
  .object({
    email: z.boolean(),
    chats: z.boolean(),
    browser: z.boolean(),
    jobs: z.boolean(),
    quietWhenHere: z.boolean(),
  })
  .partial();

/** Which emails the account wants. In the app it is always told. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return Response.json(await notifyPrefs(user.id), { headers: { "cache-control": "no-store" } });
}

/** Change some of the switches. Answers with all of them as they now stand. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = Change.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "That setting was not understood." }, { status: 400 });
  return Response.json(await saveNotifyPrefs(user.id, body.data));
}
