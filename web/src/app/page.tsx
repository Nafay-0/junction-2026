import type { Metadata } from "next";
import { Landing } from "./_landing/landing";
import { LANDING_TEXT } from "./_landing/landing.text";

const t = LANDING_TEXT.en.meta;

export const metadata: Metadata = {
  title: t.title,
  description: t.description,
  openGraph: { title: t.title, description: t.description, images: [{ url: "/landing/hero-desktop-store.webp", width: 1920, height: 1200 }] },
};

/** The landing page: what AimoPilot is, every agent, the security model and the measurements. The wall lives at /wall. */
export default function Home() {
  return <Landing />;
}
