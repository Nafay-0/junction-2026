import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { databaseReady } from "@/lib/db/start";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./session";

/*
 * Who is asking. Every page and every API route that touches someone's data starts here:
 *
 *   const user = await requireUser();
 *   if (user instanceof Response) return user;
 *
 * The cookie is checked against the database on each request, so signing out, blocking or
 * deleting an account takes effect at once.
 */

export type { SessionUser };

const load = cache(async (): Promise<SessionUser | null> => {
  if (await databaseReady()) return null;
  try {
    const jar = await cookies();
    return await userForToken(jar.get(SESSION_COOKIE)?.value);
  } catch (err) {
    console.error("[auth] could not read the session", err);
    return null;
  }
});

/** The signed-in account, or null: signed out, the session ran out, or the account is blocked. */
export async function currentUser(): Promise<SessionUser | null> {
  return load();
}

const refuse = (status: number, error: string) => Response.json({ error }, { status });

/** For API routes: the signed-in account, or the response to send back (401, or 503 with no database). */
export async function requireUser(): Promise<SessionUser | Response> {
  const problem = await databaseReady();
  if (problem) return refuse(503, problem);
  const user = await currentUser();
  return user ?? refuse(401, "You are signed out. Sign in again.");
}

/** For the admin's API routes: the admin, or the response to send back (401, or 403 for anyone else). */
export async function requireAdmin(): Promise<SessionUser | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return user.role === "admin" ? user : refuse(403, "Only the admin can do that.");
}
