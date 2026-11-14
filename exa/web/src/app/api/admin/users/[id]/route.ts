import { requireAdmin } from "@/lib/auth/server";
import { AccountChange, firstProblem } from "@/lib/auth/validation";
import { deleteAccount, updateAccount } from "@/lib/db/admin";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const NOT_FOUND = () => Response.json({ error: "There is no such account." }, { status: 404 });

/** Change an account: `{ name }`, `{ status: "blocked" | "active" }` or `{ password }`. There is no way to change a role. */
export async function PATCH(req: Request, { params }: Context) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();
  const parsed = AccountChange.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstProblem(parsed.error) }, { status: 400 });
  if (id === admin.id && parsed.data.status === "blocked") return Response.json({ error: "You cannot block your own account." }, { status: 400 });
  const result = await updateAccount(id, parsed.data);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
}

/** Delete an account, with its sign-ins and its conversations. */
export async function DELETE(_req: Request, { params }: Context) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  if (!isUuid(id)) return NOT_FOUND();
  if (id === admin.id) return Response.json({ error: "You cannot delete your own account." }, { status: 400 });
  const result = await deleteAccount(id);
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
}
