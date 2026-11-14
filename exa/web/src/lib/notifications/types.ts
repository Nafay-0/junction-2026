/*
 * Notifications, as the server and the interface both know them. No imports: this file is used
 * on both sides.
 *
 * In the app a notification is always shown. An email is sent only when the account's settings
 * allow it and, for chats and the live browser, only when the user is away: someone who has
 * Beryl open in front of them sees the notice there and needs no email about it. A job's result
 * is the exception, because the email is what the job is for.
 */

export type NotifyKind =
  /** A chat the user asked to hear about has finished. */
  | "chat_done"
  /** The live browser in the desktop app is waiting for the user: an approval, a sign-in. */
  | "needs_you"
  /** A job has run and has a result. */
  | "job_done"
  /** A job could not run, or broke off. */
  | "job_failed";

export type NotifyCategory = "chats" | "browser" | "jobs";

export const categoryOf = (kind: NotifyKind): NotifyCategory => (kind === "chat_done" ? "chats" : kind === "needs_you" ? "browser" : "jobs");

/** Which emails an account wants. */
export type NotifyPrefs = {
  /** The main switch. Off: no email of any kind. */
  email: boolean;
  /** When a chat the user asked to hear about has finished. */
  chats: boolean;
  /** When the live browser is waiting for them. */
  browser: boolean;
  /** When a job has run: its result, or why it could not run. */
  jobs: boolean;
  /** Hold back emails about chats and the browser while the user has Beryl open. Job results are sent either way. */
  quietWhenHere: boolean;
};

export const DEFAULT_NOTIFY: NotifyPrefs = { email: true, chats: true, browser: true, jobs: true, quietWhenHere: true };

/** What is stored (only the switches someone changed) laid over the defaults. */
export function cleanNotify(value: unknown): NotifyPrefs {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const pick = (key: keyof NotifyPrefs) => (typeof stored[key] === "boolean" ? (stored[key] as boolean) : DEFAULT_NOTIFY[key]);
  return { email: pick("email"), chats: pick("chats"), browser: pick("browser"), jobs: pick("jobs"), quietWhenHere: pick("quietWhenHere") };
}

/** One notification as the interface shows it. */
export type NotificationItem = {
  id: string;
  kind: NotifyKind;
  title: string;
  body: string;
  /** What a click opens: a chat, or a job (and one of its runs). */
  conversationId?: string;
  jobId?: string;
  runId?: string;
  /** Milliseconds since 1970. */
  createdAt: number;
  read: boolean;
};

/** What `/api/notifications` answers. */
export type NotificationList = { items: NotificationItem[]; unread: number };

/** How long a chat works before the interface offers to tell the user when it is done. */
export const SLOW_AFTER_MS = 30_000;
/** How often a window that is in front says so, and how long the server takes its word for. */
export const PRESENCE_EVERY_MS = 25_000;
export const PRESENCE_LASTS_MS = 70_000;
/** How long the live browser waits for the user before an email about it is worth sending. */
export const NEEDS_YOU_EMAIL_AFTER_MS = 60_000;
