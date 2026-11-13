import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dock",
  description: "Open gateway for AI purchasing agents, with signed mandates and human sign-off.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
