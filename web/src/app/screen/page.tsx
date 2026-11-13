import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { joinLink } from "@/server/approval-links";
import { ScreenFeed } from "./screen-feed";

export const metadata: Metadata = { title: "Dock: live" };

/**
 * The big screen at the table: the QR code that makes a visitor an approver, and live sign-offs as they happen.
 * Functional; the visual design pass comes later.
 */
export default function ScreenPage() {
  return (
    <main className="grid min-h-dvh grid-cols-1 gap-8 p-8 lg:grid-cols-[minmax(320px,420px)_1fr]">
      <section>
        <h1 className="text-4xl font-bold">Become the approver</h1>
        <p className="mt-2 text-xl">Scan with your phone. You become the purchasing manager of a hotel kitchen, and its AI buyer asks you when it goes over its limit.</p>
        <Suspense fallback={<div className="mt-6 aspect-square w-full max-w-sm bg-neutral-100" />}>
          <JoinQr />
        </Suspense>
      </section>
      <ScreenFeed />
    </main>
  );
}

async function JoinQr() {
  const link = await joinLink(await headers());
  return (
    <figure className="mt-6 max-w-sm">
      <div className="w-full bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
      <figcaption className="mt-2 break-all text-lg text-neutral-600">{link.url}</figcaption>
    </figure>
  );
}
