import type { Metadata } from "next";
import { Landing2 } from "./_landing2/landing2";
import { L2 } from "./_landing2/landing2.text";

export const metadata: Metadata = {
  title: L2.meta.title,
  description: L2.meta.description,
  openGraph: { title: L2.meta.title, description: L2.meta.description, images: [{ url: "/landing/hero-desktop-store.webp", width: 1920, height: 1200 }] },
};

/** The landing page: the product performing itself, the facts that matter, and the ways in. The wall lives at /wall. */
export default function Home() {
  return <Landing2 />;
}
