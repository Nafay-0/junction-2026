import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { SessionProvider } from "@/lib/auth/client";
import { currentUser } from "@/lib/auth/server";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `Admin · ${APP_NAME}` };
export const dynamic = "force-dynamic";

/**
 * The admin area. Signed out, it leads to the sign-in page and back. For any account but the
 * admin it does not exist: a 404, the same as an address that was never there.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent((await headers()).get("x-beryl-path") ?? "/admin")}`);
  if (user.role !== "admin") notFound();
  return (
    <SessionProvider user={user}>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
