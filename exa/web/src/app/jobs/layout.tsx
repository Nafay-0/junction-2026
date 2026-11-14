import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { JobsShell } from "@/components/jobs/jobs-shell";
import { SessionProvider } from "@/lib/auth/client";
import { currentUser } from "@/lib/auth/server";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `Jobs · ${APP_NAME}` };
export const dynamic = "force-dynamic";

/**
 * The Jobs page: what the account has asked Beryl to do on a schedule. For anyone signed in, on
 * the web and in the desktop app alike. Signed out, it leads to the sign-in page and back.
 */
export default async function JobsLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const asked = await headers();
  // Back to the very job or run that was asked for, once signed in.
  if (!user) redirect(`/login?next=${encodeURIComponent(asked.get("x-beryl-path") ?? "/jobs")}`);
  // The desktop app says so in its user agent: there the page sits beside the app's live browser.
  const inApp = /BerylDesktop\//.test(asked.get("user-agent") ?? "");
  return (
    <SessionProvider user={user}>
      <JobsShell inApp={inApp}>{children}</JobsShell>
    </SessionProvider>
  );
}
