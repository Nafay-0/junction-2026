import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

// Barlow is drawn after the lettering on road and highway signs: the voice of a loading dock, not of an app.
// The condensed cut carries big numerals and headings; the regular cut carries everything people read.
const barlow = Barlow({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-barlow", display: "swap" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700", "800"], variable: "--font-barlow-condensed", display: "swap" });

export const metadata: Metadata = {
  title: "Dock",
  description: "Open gateway for AI purchasing agents, with signed mandates and human sign-off.",
};

export const viewport: Viewport = { themeColor: "#1d2329" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
