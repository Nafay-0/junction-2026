import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** Who is signed in on this device. 401 when nobody is. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return Response.json({ user });
}
