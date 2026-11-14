import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

const title = `${APP_NAME} · ${APP_TAGLINE}`;
const description = `Ask ${APP_NAME} for anything. It finds it on the live web, shows you the answer, and in the desktop app it does the clicking too.`;

/** What search engines and link previews are told about the front page. */
export const LANDING_METADATA: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", siteName: APP_NAME, images: [{ url: "/landing/og.jpg", width: 1200, height: 630, alt: `${APP_NAME} showing coffee shops on a map` }] },
  twitter: { card: "summary_large_image", title, description, images: ["/landing/og.jpg"] },
};
