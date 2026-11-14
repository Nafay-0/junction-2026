import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Butler } from "@/components/butler/butler";
import { Landing } from "@/components/landing/landing";
import { LANDING_METADATA } from "@/components/landing/metadata";
import { SessionProvider } from "@/lib/auth/client";
import { currentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = LANDING_METADATA;

/**
 * The front door. A signed-in account gets the app, which every part of the interface can then
 * read the account from. Anyone else gets the website's landing page, except in the desktop app:
 * there is nothing to advertise to someone who has already installed it, so it goes to sign in.
 */
export default async function Home() {
  const user = await currentUser();
  if (user) {
    return (
      <SessionProvider user={user}>
        <Butler />
      </SessionProvider>
    );
  }
  if (/BerylDesktop\//.test((await headers()).get("user-agent") ?? "")) redirect("/login");
  return <Landing demoVideo={process.env.BERYL_DEMO_VIDEO ?? ""} />;
}
