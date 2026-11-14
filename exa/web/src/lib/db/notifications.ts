import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { cleanNotify, type NotificationItem, type NotifyKind, type NotifyPrefs } from "@/lib/notifications/types";
import { database } from "./client";
import { conversations, notifications, users, type NotificationRow } from "./schema";

/* Notifications and the settings that go with them. Every function is asked by account. */

const toItem = (row: NotificationRow): NotificationItem => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  conversationId: row.conversationId ?? undefined,
  jobId: row.jobId ?? undefined,
  runId: row.runId ?? undefined,
  createdAt: row.createdAt.getTime(),
  read: row.readAt !== null,
});

export type NewNotification = {
  userId: string;
  kind: NotifyKind;
  title: string;
  body?: string;
  conversationId?: string;
  jobId?: string;
  runId?: string;
  /** The same event must not be told twice: a second notice with this key is not made. */
  dedupe?: string;
};

/** Make a notification. Null when one with the same `dedupe` key already exists for the account. */
export async function insertNotification(input: NewNotification): Promise<NotificationItem | null> {
  const [row] = await database()
    .insert(notifications)
    .values({
      userId: input.userId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: (input.body ?? "").slice(0, 600),
      conversationId: input.conversationId?.slice(0, 80) ?? null,
      jobId: input.jobId ?? null,
      runId: input.runId ?? null,
      dedupe: input.dedupe?.slice(0, 200) ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return row ? toItem(row) : null;
}

/** The account's latest notifications, newest first, and how many it has not read. */
export async function listNotifications(userId: string, limit = 40): Promise<{ items: NotificationItem[]; unread: number }> {
  const db = database();
  const [rows, [count]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items: rows.map(toItem), unread: count?.unread ?? 0 };
}

/** Mark some, or all, of the account's notifications as read. */
export async function markRead(userId: string, ids: string[] | "all"): Promise<void> {
  if (ids !== "all" && ids.length === 0) return;
  await database()
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ids === "all" ? undefined : inArray(notifications.id, ids.slice(0, 200))));
}

/** Remove the account's notifications: one, or all of them. */
export async function deleteNotifications(userId: string, id?: string): Promise<void> {
  await database()
    .delete(notifications)
    .where(and(eq(notifications.userId, userId), id ? eq(notifications.id, id) : undefined));
}

/** The user has dealt with what a notice was about (they approved, they signed in): no email is due for it any more. */
export async function resolveNotification(userId: string, dedupe: string): Promise<void> {
  await database()
    .update(notifications)
    .set({ resolvedAt: sql`now()`, readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.userId, userId), eq(notifications.dedupe, dedupe), isNull(notifications.resolvedAt)));
}

/** Whether a notice still stands: not read, not dealt with, not emailed yet. */
export async function stillDue(id: string): Promise<boolean> {
  const [row] = await database().select({ readAt: notifications.readAt, resolvedAt: notifications.resolvedAt, emailedAt: notifications.emailedAt }).from(notifications).where(eq(notifications.id, id)).limit(1);
  return Boolean(row) && row.readAt === null && row.resolvedAt === null && row.emailedAt === null;
}

export async function markEmailed(id: string): Promise<void> {
  await database().update(notifications).set({ emailedAt: sql`now()` }).where(eq(notifications.id, id));
}

/** Who to write to and what they want to hear about. Null when the account is gone or blocked. */
export async function recipient(userId: string): Promise<{ email: string; name: string; prefs: NotifyPrefs } | null> {
  const [row] = await database().select({ email: users.email, name: users.name, status: users.status, notify: users.notify }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row || row.status !== "active") return null;
  return { email: row.email, name: row.name, prefs: cleanNotify(row.notify) };
}

export async function notifyPrefs(userId: string): Promise<NotifyPrefs> {
  const [row] = await database().select({ notify: users.notify }).from(users).where(eq(users.id, userId)).limit(1);
  return cleanNotify(row?.notify);
}

/** Save the account's email settings. What comes back is what is now in force. */
export async function saveNotifyPrefs(userId: string, change: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
  const next = cleanNotify({ ...(await notifyPrefs(userId)), ...change });
  await database()
    .update(users)
    .set({ notify: sql`${JSON.stringify(next)}::jsonb` })
    .where(eq(users.id, userId));
  return next;
}

/** The user asks to be told when the answer being worked on in this chat is finished (or takes that back). */
export async function setNotifyWhenDone(userId: string, conversationId: string, on: boolean): Promise<boolean> {
  const rows = await database()
    .update(conversations)
    .set({ notifyWhenDone: on })
    .where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function wantsNotifyWhenDone(userId: string, conversationId: string): Promise<boolean> {
  const [row] = await database().select({ on: conversations.notifyWhenDone }).from(conversations).where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId))).limit(1);
  return row?.on === true;
}

/** The chat has finished: take the request back, and say whether there was one. Happens once. */
export async function takeNotifyWhenDone(userId: string, conversationId: string): Promise<{ title: string } | null> {
  const [row] = await database()
    .update(conversations)
    .set({ notifyWhenDone: false })
    .where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId), eq(conversations.notifyWhenDone, true)))
    .returning({ title: conversations.title });
  return row ?? null;
}

/** The name of one of the account's chats, for a notice about it. Null when it has no such chat. */
export async function conversationTitle(userId: string, conversationId: string): Promise<string | null> {
  const [row] = await database().select({ title: conversations.title }).from(conversations).where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId))).limit(1);
  return row?.title ?? null;
}
