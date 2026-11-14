import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DoorsPreview } from "../_channels/preview";
import { Wordmark } from "../_ui/wordmark";
import { callLink } from "@/server/channels/call-links";
import { getRuntime } from "@/server/runtime";

export const metadata: Metadata = { title: "AimoPilot: voice and photo doors" };

/**
 * Preview of the two extra doors for a demo kitchen: /channels?k=kaari (default) or ?k=laakso.
 * The portal mounts the same components (<CallAgent>, <ScanDoor>) in its assistant panel.
 */
export default function ChannelsPage(props: PageProps<"/channels">) {
  return (
    <main className="min-h-dvh bg-concrete px-4 py-6 text-ink sm:px-8">
      <Suspense fallback={<Wordmark size={28} />}>
        <Body {...props} />
      </Suspense>
    </main>
  );
}

async function Body({ searchParams }: PageProps<"/channels">) {
  await connection();
  const k = (await searchParams).k === "laakso" ? "laakso" : "kaari";
  const h = await headers();
  const visitorCall = await callLink(h);
  const { dock } = await getRuntime();
  const doors = dock.ledger
    .entries()
    .filter((e) => e.data.step === "door")
    .slice(-8)
    .reverse();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Wordmark size={28} />
          <h1 className="font-display text-3xl font-bold">Every door, one gate</h1>
        </div>
        <nav className="flex gap-2 text-[1.02rem]">
          {(["kaari", "laakso"] as const).map((s) => (
            <Link key={s} href={`/channels?k=${s}`} className={`rounded-full border-2 border-ink px-3 py-1 font-semibold ${k === s ? "bg-ink text-paper" : "bg-paper"}`}>
              {s === "kaari" ? "Ravintola Kaari" : "Laakso Catering"}
            </Link>
          ))}
        </nav>
      </header>
      <p className="text-sm text-ink-soft">Demo on synthetic data. Orders go through the same checks, gate and sign-off as the typed console.</p>
      <DoorsPreview key={k} kitchen={k} />
      <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <section className="rounded-xl border-2 border-ink bg-paper p-4">
          <h2 className="font-display text-xl font-bold">Call from your phone</h2>
          <div className="mt-2 size-44" dangerouslySetInnerHTML={{ __html: visitorCall.qrSvg }} />
          <p className="mt-2 max-w-56 break-all text-sm">{visitorCall.url}</p>
          <p className="mt-1 max-w-56 text-sm text-ink-soft">Gives you your own kitchen (one passkey tap), then calls its agent. Sign-off comes back to the same phone.</p>
        </section>
        <section className="rounded-xl border-2 border-ink bg-paper p-4">
          <h2 className="font-display text-xl font-bold">Requests by door, in the ledger</h2>
          {doors.length === 0 ? (
            <p className="mt-2 text-ink-soft">No request through these doors yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-[0.98rem]">
              {doors.map((e) => (
                <li key={e.seq}>
                  <span className="mr-2 rounded bg-ink px-2 py-0.5 text-xs font-bold uppercase text-paper">{String(e.data.door)}</span>
                  {e.summary}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
