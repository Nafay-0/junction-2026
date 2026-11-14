import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionCookieOptions } from "@/lib/auth/cookie";
import { addressOf, noteFailedSignIn, noteSignedIn, waitBeforeSignIn } from "@/lib/auth/limit";
import { MAX_PASSWORD, pretendToVerify, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, createSession } from "@/lib/auth/session";
import { clientKindOf } from "@/lib/client-kind";
import { database } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { databaseReady } from "@/lib/db/start";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  password: z.string().min(1).max(MAX_PASSWORD),
});

/** One answer for a wrong email and a wrong password: which of the two it was is nobody's business. */
const NO_MATCH = "That email and password do not match an account.";

/**
 * Sign in with an email and a password. Sets the session cookie.
 *
 * The sign-in page sends JSON. If someone presses Enter before the page has taken its form over
 * (a slow connection, a phone), the browser sends the form itself: that arrives here as an
 * ordinary form post and is answered with a redirect, into the app or back to the sign-in page.
 */
export async function POST(req: Request) {
  const plainForm = /form/i.test(req.headers.get("content-type") ?? "");
  const refuse = (status: number, error: string, headers?: HeadersInit) => (plainForm ? NextResponse.redirect(new URL("/login", req.url), 303) : Response.json({ error }, { status, headers }));

  const problem = await databaseReady();
  if (problem) return refuse(503, problem);

  const sent = plainForm
    ? await req
        .formData()
        .then((data) => ({ email: data.get("email"), password: data.get("password") }))
        .catch(() => null)
    : await req.json().catch(() => null);
  const parsed = Body.safeParse(sent);
  if (!parsed.success) return refuse(400, "Enter your email address and your password.");
  const { email, password } = parsed.data;

  const address = addressOf(req);
  const wait = waitBeforeSignIn(email, address);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60);
    return refuse(429, `Too many tries. Wait ${minutes === 1 ? "a minute" : `${minutes} minutes`} and try again.`, { "retry-after": String(wait) });
  }

  const [user] = await database().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    // Take as long as a real check would, so the timing gives nothing away either.
    await pretendToVerify(password);
    noteFailedSignIn(email, address);
    return refuse(401, NO_MATCH);
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    noteFailedSignIn(email, address);
    return refuse(401, NO_MATCH);
  }
  // Said only to someone who knows the password, so it tells a stranger nothing.
  if (user.status !== "active") return refuse(403, "This account has been blocked. Ask whoever gave you the account.");

  noteSignedIn(email);
  const token = await createSession(user.id, clientKindOf(req), req.headers.get("user-agent"));
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(req));
  if (plainForm) return NextResponse.redirect(new URL("/", req.url), 303);
  return Response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}
