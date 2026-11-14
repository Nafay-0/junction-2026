import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/account/login-screen";
import { currentUser } from "@/lib/auth/server";
import { APP_NAME } from "@/lib/brand";
import { databaseReady } from "@/lib/db/start";

export const metadata: Metadata = { title: `Sign in · ${APP_NAME}` };
export const dynamic = "force-dynamic";

/** Only a path on this site may follow a sign-in: never another site, and not the sign-in page itself. */
function safeNext(next: string | string[] | undefined): string {
  const path = Array.isArray(next) ? next[0] : next;
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.startsWith("/login") || path.startsWith("/api/")) return "/";
  return path;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  // Already signed in: there is nothing to do here.
  if (await currentUser()) redirect(next);
  return <LoginScreen next={next} problem={await databaseReady()} />;
}
