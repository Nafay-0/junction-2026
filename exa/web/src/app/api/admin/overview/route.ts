import { requireAdmin } from "@/lib/auth/server";
import { overview } from "@/lib/db/admin";

export const dynamic = "force-dynamic";

/** The figures behind the admin's overview. `?days=14` (the default) or `?days=30`. */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const days = Number(new URL(req.url).searchParams.get("days")) === 30 ? 30 : 14;
  return Response.json(await overview(days));
}
