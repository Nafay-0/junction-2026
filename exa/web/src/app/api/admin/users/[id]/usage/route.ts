import { requireAdmin } from "@/lib/auth/server";
import { accountUsage } from "@/lib/db/admin";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * What one account used: its cost by kind (LLMs, Exa, voice, decisions), by mode and by model,
 * and its requests. `?days=14` (the default) or `?days=30`. For the admin only, who sees the
 * models' names as well as the modes.
 */
export async function GET(req: Request, { params }: Context) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const days = Number(new URL(req.url).searchParams.get("days")) === 30 ? 30 : 14;
  const usage = isUuid(id) ? await accountUsage(id, days) : null;
  return usage ? Response.json(usage) : Response.json({ error: "There is no such account." }, { status: 404 });
}
