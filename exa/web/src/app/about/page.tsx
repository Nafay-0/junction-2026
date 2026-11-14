import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";
import { LANDING_METADATA } from "@/components/landing/metadata";
import { currentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = LANDING_METADATA;

/** The landing page at an address of its own, for anyone: signed in, it offers the way back into the app. */
export default async function About() {
  return <Landing signedIn={Boolean(await currentUser())} demoVideo={process.env.BERYL_DEMO_VIDEO ?? ""} />;
}
