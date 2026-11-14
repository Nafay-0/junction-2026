import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountsScreen } from "@/components/admin/accounts";
import { currentUser } from "@/lib/auth/server";
import { APP_NAME } from "@/lib/brand";
import { listAccounts } from "@/lib/db/admin";

export const metadata: Metadata = { title: `Accounts · Admin · ${APP_NAME}` };
export const dynamic = "force-dynamic";

/** Every account, for the admin: add, block, give a new password, delete. */
export default async function AdminAccountsPage() {
  const user = await currentUser();
  if (user?.role !== "admin") notFound();
  // The time this was rendered goes along, so "3 hours ago" reads the same on the server and in the browser's first paint.
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request
  return <AccountsScreen accounts={await listAccounts()} renderedAt={Date.now()} />;
}
