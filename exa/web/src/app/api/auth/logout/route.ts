import { cookies } from "next/headers";
import { SESSION_COOKIE, endSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Sign out on this device: the session is deleted on the server and the cookie is taken back. */
export async function POST() {
  const jar = await cookies();
  try {
    await endSession(jar.get(SESSION_COOKIE)?.value);
  } catch {
    /* the database is away: taking the cookie back still signs this device out */
  }
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
