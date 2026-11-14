import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

// Barlow is drawn after the lettering on road and highway signs: the voice of a loading dock, not of an app.
// The condensed cut carries big numerals and headings; the regular cut carries everything people read.
const barlow = Barlow({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-barlow", display: "swap" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700", "800"], variable: "--font-barlow-condensed", display: "swap" });

export const metadata: Metadata = {
  title: "AimoPilot",
  description: "A wholesale shop for professional kitchens. Each kitchen's AI purchasing agent orders under a signed mandate; plain code checks every order, and a named person signs off when needed.",
  applicationName: "AimoPilot",
};

export const viewport: Viewport = { themeColor: "#003646" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
