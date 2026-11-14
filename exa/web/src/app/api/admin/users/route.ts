import { requireAdmin } from "@/lib/auth/server";
import { NewAccount, firstProblem } from "@/lib/auth/validation";
import { createAccount, listAccounts } from "@/lib/db/admin";

export const dynamic = "force-dynamic";

/** Every account, with how much it has been used. */
export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  return Response.json({ accounts: await listAccounts() });
}

/** Add an account. It is always an ordinary one: the only admin is the account in ADMIN_EMAIL. */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const parsed = NewAccount.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstProblem(parsed.error) }, { status: 400 });
  const result = await createAccount(parsed.data);
  return result.ok ? Response.json({ id: result.id }, { status: 201 }) : Response.json({ error: result.error }, { status: result.status });
}
