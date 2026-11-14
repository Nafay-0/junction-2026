import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

const title = `${APP_NAME} · ${APP_TAGLINE}`;
const description = `Tell ${APP_NAME} what you need. It searches the live web, shows you the answer, and can finish the job in a browser while you watch.`;

/** What search engines and link previews are told about the front page. */
export const LANDING_METADATA: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", siteName: APP_NAME, images: [{ url: "/landing/og.jpg", width: 1200, height: 630, alt: `${APP_NAME} showing coffee shops on a map` }] },
  twitter: { card: "summary_large_image", title, description, images: ["/landing/og.jpg"] },
};
