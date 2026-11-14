import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { APP_NAME } from "@/lib/brand";
import { validConversationId } from "@/lib/db/conversations";
import { conversationTitle, resolveNotification } from "@/lib/db/notifications";
import { notify } from "@/lib/notifications/notify";
import { NEEDS_YOU_EMAIL_AFTER_MS } from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  conversationId: z.string(),
  /** The step that is waiting: the approval's id, or the hand-over request's. */
  toolCallId: z.string().min(1).max(120),
  /** What the user is needed for. */
  what: z.enum(["approval", "login", "captcha", "verification", "payment", "other"]).default("other"),
  /** What the step will do, or what the agent asked for, in the agent's words. */
  text: z.string().max(600).optional(),
  /** The user has dealt with it. */
  resolved: z.boolean().optional(),
});

const TITLES: Record<z.infer<typeof Body>["what"], string> = {
  approval: `${APP_NAME} is waiting for your approval`,
  login: `${APP_NAME} needs you to sign in`,
  captcha: `${APP_NAME} needs you to pass a check`,
  verification: `${APP_NAME} needs a code from you`,
  payment: "A payment page is waiting for you",
  other: `${APP_NAME} needs you in the browser`,
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * The desktop app says its live browser is waiting for the user (a step that needs their yes, a
 * page handed to them), or that it no longer is. The notice shows in the app at once. An email
 * follows only if, a minute on, it is still waiting and the user is away.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success || !validConversationId(body.data.conversationId)) return Response.json({ error: "That request was not understood." }, { status: 400 });
  const { conversationId, toolCallId, what, text, resolved } = body.data;
  const dedupe = `needs:${toolCallId}`;

  if (resolved) {
    await resolveNotification(user.id, dedupe);
    return Response.json({ ok: true });
  }

  // Only about a chat of the account's own.
  const title = await conversationTitle(user.id, conversationId);
  if (title === null) return Response.json({ error: "There is no such chat." }, { status: 404 });
  const said = text?.replace(/\s+/g, " ").trim();
  const made = await notify({
    userId: user.id,
    kind: "needs_you",
    title: TITLES[what],
    body: clip([said, `In the chat "${clip(title, 80)}".`].filter(Boolean).join(" "), 400),
    conversationId,
    dedupe,
    email: "away",
    afterMs: NEEDS_YOU_EMAIL_AFTER_MS,
  });
  return Response.json({ ok: true, id: made.item?.id ?? null });
}
