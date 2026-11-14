import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { ClientKind } from "@/lib/client-kind";
import { database } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { SESSION_COOKIE, SESSION_SECONDS } from "./cookie";
import type { SessionUser } from "./types";

/*
 * Sign-ins. A session is 32 random bytes handed to the browser in a cookie that scripts cannot
 * read. The database keeps only the SHA-256 of it, so a copy of the database cannot be used to
 * sign in as anyone. A session lasts 30 days from its last use.
 */

export { SESSION_COOKIE, SESSION_SECONDS };
export type { SessionUser };

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const later = () => new Date(Date.now() + SESSION_SECONDS * 1000);
/** How stale "last seen" may get before it is written again: a write per request would be wasteful. */
const TOUCH_AFTER_MS = 5 * 60_000;

export async function createSession(userId: string, client: ClientKind, userAgent: string | null): Promise<string> {
  const db = database();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.insert(sessions).values({ tokenHash: hashOf(token), userId, client, userAgent: userAgent?.slice(0, 300) ?? null, expiresAt: later() });
  await db.update(users).set({ lastLoginAt: now, lastSeenAt: now }).where(eq(users.id, userId));
  // Housekeeping, on the quiet: sessions that ran out are of no use to anyone.
  void db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .catch(() => {});
  return token;
}

/** The account a session token belongs to, or null: unknown token, run out, or a blocked account. */
export async function userForToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const db = database();
  const now = new Date();
  const [row] = await db
    .select({ sessionId: sessions.id, seenAt: sessions.lastSeenAt, id: users.id, email: users.email, name: users.name, role: users.role, status: users.status })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashOf(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (row.status !== "active") {
    await db.delete(sessions).where(eq(sessions.userId, row.id));
    return null;
  }
  if (now.getTime() - row.seenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: now, expiresAt: later() }).where(eq(sessions.id, row.sessionId));
    await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.id));
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function endSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await database().delete(sessions).where(eq(sessions.tokenHash, hashOf(token)));
}

/** Sign an account out everywhere: used when it is blocked, deleted or given a new password. */
export async function endSessionsOf(userId: string): Promise<void> {
  await database().delete(sessions).where(eq(sessions.userId, userId));
}
