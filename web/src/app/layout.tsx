import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";

// Figtree carries everything people read: open, friendly, even at small sizes, with true tabular figures.
// Bricolage Grotesque carries titles and big figures: a contemporary grotesque with some warmth, set a little narrow
// (its width axis) so Finnish compounds fit. Both have full Finnish and Swedish glyphs.
const figtree = Figtree({ subsets: ["latin", "latin-ext"], variable: "--font-figtree", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], axes: ["opsz", "wdth"], variable: "--font-bricolage", display: "swap" });

export const metadata: Metadata = {
  title: "AimoPilot",
  description: "A wholesale shop for professional kitchens. Each kitchen's AI purchasing agent orders under a signed mandate; plain code checks every order, and a named person signs off when needed.",
  applicationName: "AimoPilot",
};

export const viewport: Viewport = { themeColor: "#ffffff", viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} ${bricolage.variable}`}>
      <body>{children}</body>
    </html>
  );
}
