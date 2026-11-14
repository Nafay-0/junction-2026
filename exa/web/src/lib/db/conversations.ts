import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ClientKind } from "@/lib/client-kind";
import { database } from "./client";
import { conversations } from "./schema";

/*
 * Conversations, always asked for by account: every function takes the user's id and never
 * touches a row that is not theirs. A conversation belongs to the kind of client it was started
 * in; the other kind can read, rename and delete it, but not add to it.
 */

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  modelLabel?: string;
  origin: ClientKind;
};

/** Ids are chosen by the client: a UUID, or the short random id older browsers make. */
export const validConversationId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{6,80}$/.test(id);

const summary = {
  id: conversations.id,
  title: conversations.title,
  createdAt: conversations.createdAt,
  updatedAt: conversations.updatedAt,
  modelLabel: conversations.modelLabel,
  origin: conversations.origin,
};
type SummaryRow = { id: string; title: string; createdAt: Date; updatedAt: Date; modelLabel: string | null; origin: ClientKind };

const toSummary = (row: SummaryRow): ConversationSummary => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
  modelLabel: row.modelLabel ?? undefined,
  origin: row.origin,
});

const mine = (userId: string, id: string) => and(eq(conversations.userId, userId), eq(conversations.id, id));

const cleanTitle = (title: string) => {
  const t = title.replace(/\s+/g, " ").trim();
  return (t.length > 200 ? `${t.slice(0, 199)}…` : t) || "New task";
};

/**
 * Postgres' jsonb refuses two things JavaScript strings may hold: the NUL character and half of a
 * surrogate pair (both turn up in text scraped from the web). JSON.stringify writes them as
 * escapes, so they are taken out of the JSON text: NUL is dropped, a lone half becomes U+FFFD.
 * An escaped backslash is matched first, so the text "\\u0000" (a backslash, then letters) is left alone.
 */
export function jsonForPostgres(value: unknown): string {
  return JSON.stringify(value).replace(/\\\\|\\u0000|\\u[dD][89a-fA-F][0-9a-fA-F]{2}/g, (m) => (m === "\\\\" ? m : m === "\\u0000" ? "" : "\\ufffd"));
}

/** This account's conversations, newest first, without their messages. */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const rows = await database().select(summary).from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt)).limit(1000);
  return rows.map(toSummary);
}

export async function getConversation(userId: string, id: string): Promise<{ meta: ConversationSummary; messages: unknown[] } | null> {
  const [row] = await database()
    .select({ ...summary, messages: conversations.messages })
    .from(conversations)
    .where(mine(userId, id))
    .limit(1);
  if (!row) return null;
  return { meta: toSummary(row), messages: Array.isArray(row.messages) ? row.messages : [] };
}

/** Where this account's conversation was started, or null when the account has no such conversation. */
export async function conversationOrigin(userId: string, conversationId: string): Promise<ClientKind | null> {
  if (!validConversationId(conversationId)) return null;
  const [row] = await database().select({ origin: conversations.origin }).from(conversations).where(mine(userId, conversationId)).limit(1);
  return row?.origin ?? null;
}

export type SaveResult = { saved: true; meta: ConversationSummary } | { saved: false; origin: ClientKind };

/**
 * Save the whole message list. The first save creates the conversation and fixes where it was
 * started; later saves replace the messages, and only from that same kind of client. The title is
 * set once, here, and afterwards only by renaming, so a rename is never undone by a save.
 */
export async function saveConversation(
  userId: string,
  id: string,
  client: ClientKind,
  input: { title: string; modelLabel?: string | null; messages: unknown[] },
): Promise<SaveResult> {
  const db = database();
  const json = jsonForPostgres(input.messages);
  const [row] = await db
    .insert(conversations)
    .values({
      userId,
      id,
      title: cleanTitle(input.title),
      origin: client,
      modelLabel: input.modelLabel?.slice(0, 80) ?? null,
      messages: sql`${json}::jsonb`,
      messageCount: input.messages.length,
    })
    .onConflictDoUpdate({
      target: [conversations.userId, conversations.id],
      set: {
        messages: sql`excluded.messages`,
        messageCount: sql`excluded.message_count`,
        modelLabel: sql`coalesce(excluded.model_label, ${conversations.modelLabel})`,
        updatedAt: sql`now()`,
      },
      // From the other kind of client nothing is written: no row comes back, and we say why below.
      setWhere: sql`${conversations.origin} = excluded.origin`,
    })
    .returning(summary);
  if (row) return { saved: true, meta: toSummary(row) };
  const origin = await conversationOrigin(userId, id);
  return { saved: false, origin: origin ?? client };
}

export async function renameConversation(userId: string, id: string, title: string): Promise<ConversationSummary | null> {
  const [row] = await database()
    .update(conversations)
    .set({ title: cleanTitle(title) })
    .where(mine(userId, id))
    .returning(summary);
  return row ? toSummary(row) : null;
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const rows = await database().delete(conversations).where(mine(userId, id)).returning({ id: conversations.id });
  return rows.length > 0;
}

export async function deleteAllConversations(userId: string): Promise<number> {
  const rows = await database().delete(conversations).where(eq(conversations.userId, userId)).returning({ id: conversations.id });
  return rows.length;
}
