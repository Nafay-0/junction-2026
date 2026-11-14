import "server-only";
import { APP_NAME } from "@/lib/brand";
import { insertNotification, markEmailed, recipient, stillDue, type NewNotification } from "@/lib/db/notifications";
import { emailPage, paragraphs, type EmailPage } from "@/lib/email/layout";
import { deliverable, emailConfigured, sendEmail } from "@/lib/email/resend";
import { isHere } from "@/lib/presence";
import { siteUrl } from "@/lib/site";
import { categoryOf, type NotificationItem, type NotifyKind } from "./types";

/*
 * Telling an account about something. The notice always goes into the app. Whether an email
 * follows is decided here, in one place:
 *
 * - the account's settings: the main switch, and the switch for this kind of notice;
 * - whether the user is here. "away" sends only when no window of theirs is in front (unless
 *   they switched that rule off). "always" sends either way: a job's result is what the job
 *   is for. "never" keeps it in the app.
 * - `afterMs` waits before deciding, and then sends only if the notice is still unread and not
 *   dealt with. That is for "the browser is waiting for you": someone who is at the screen
 *   answers within the minute and needs no email.
 */

export type NotifyInput = NewNotification & {
  email?: "away" | "always" | "never";
  /** Wait this long before deciding about the email, and skip it if the notice was read or dealt with meanwhile. */
  afterMs?: number;
  /** The email itself, when it is more than the notice with a button (a job's result). */
  page?: Omit<EmailPage, "preview"> & { preview?: string; subject?: string; text?: string };
};

export type Notified = { item: NotificationItem | null; emailed: boolean };

const LABEL: Record<NotifyKind, string> = { chat_done: "Chat finished", needs_you: "Waiting for you", job_done: "Job result", job_failed: "Job problem" };

/** Where a click on a notice goes: the chat, or the job's page. Used by emails; the interface builds its own. */
export function linkFor(item: { conversationId?: string; jobId?: string; runId?: string }): string {
  const site = siteUrl();
  if (item.jobId) return `${site}/jobs?job=${encodeURIComponent(item.jobId)}${item.runId ? `&run=${encodeURIComponent(item.runId)}` : ""}`;
  if (item.conversationId) return `${site}/chat/${encodeURIComponent(item.conversationId)}`;
  return site;
}

/** Tell an account about something. Never throws; a notice that already exists (same `dedupe`) is not repeated. */
export async function notify(input: NotifyInput): Promise<Notified> {
  let item: NotificationItem | null = null;
  try {
    item = await insertNotification(input);
  } catch (err) {
    console.warn("[notify] could not save a notice", err instanceof Error ? err.message : err);
    return { item: null, emailed: false };
  }
  if (!item || (input.email ?? "away") === "never") return { item, emailed: false };
  if (input.afterMs && input.afterMs > 0) {
    const made = item;
    const timer = setTimeout(() => void emailIfDue(input, made, true), input.afterMs);
    timer.unref?.();
    return { item, emailed: false };
  }
  return { item, emailed: await emailIfDue(input, item, false) };
}

async function emailIfDue(input: NotifyInput, item: NotificationItem, waited: boolean): Promise<boolean> {
  try {
    if (!emailConfigured()) return false;
    const to = await recipient(input.userId);
    if (!to || !deliverable(to.email)) return false;
    if (!to.prefs.email || !to.prefs[categoryOf(input.kind)]) return false;
    if ((input.email ?? "away") === "away" && to.prefs.quietWhenHere && isHere(input.userId)) return false;
    if (waited && !(await stillDue(item.id))) return false;

    const link = linkFor(item);
    const page = input.page;
    const html = emailPage({
      label: page?.label ?? LABEL[input.kind],
      heading: page?.heading ?? item.title,
      lead: page?.lead,
      bodyHtml: page?.bodyHtml ?? (item.body ? paragraphs(item.body) : undefined),
      button: page?.button ?? { label: item.jobId ? "Open the job" : `Open in ${APP_NAME}`, href: link },
      why: page?.why,
      preview: page?.preview ?? (item.body || item.title),
    });
    const sent = await sendEmail({
      to: to.email,
      subject: page?.subject ?? item.title,
      html,
      text: page?.text ?? `${item.title}\n\n${item.body ? `${item.body}\n\n` : ""}${link}`,
      key: `notice-${item.id}`,
      tag: input.kind,
    });
    if (sent.ok) await markEmailed(item.id);
    return sent.ok;
  } catch (err) {
    console.warn("[notify] could not email a notice", err instanceof Error ? err.message : err);
    return false;
  }
}
