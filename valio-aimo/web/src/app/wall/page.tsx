import type { Metadata } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { Suspense } from "react";
import { asStoreError, isStoreUnavailable } from "@/server/aiven/pg/errors";
import { joinLink } from "@/server/approval-links";
import { getRuntime } from "@/server/runtime";
import { wallSnapshot } from "@/server/wall-snapshot";
import { crashBoard } from "../_wall/crash-board";
import { Wall } from "../_wall/wall";

export const metadata: Metadata = { title: "AimoPilot: live at the gate" };

/** The wall: the big screen at the table. Rendered with a live snapshot so it is never empty, then kept live. */
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-petrol-deep" />}>
      <LiveWall />
    </Suspense>
  );
}

async function LiveWall() {
  await connection(); // request-time data: never prerender
  let snapshot;
  try {
    snapshot = await getRuntime().then(wallSnapshot);
  } catch (err) {
    // The database away: say so on the big screen and look again by itself, instead of a crash page.
    if (isStoreUnavailable(asStoreError(err))) return <StoreDown />;
    throw err;
  }
  const join = await joinLink(await headers());
  return <Wall initial={snapshot} join={{ url: join.url, qrSvg: join.qrSvg }} board={crashBoard()} />;
}

function StoreDown() {
  return (
    <div className="on-dark flex min-h-dvh flex-col items-center justify-center gap-4 bg-petrol-deep p-8 text-center text-paper">
      <meta httpEquiv="refresh" content="10" />
      <h1 className="display text-[max(2rem,3vw)] leading-tight">AimoPilot can&apos;t read its records right now</h1>
      <p className="max-w-[48rem] text-[max(1.1rem,1.4vw)] leading-snug text-paper/80">
        Its database is not answering, so nothing new can be shown or signed. Nothing is lost. This screen looks again every 10 seconds.
      </p>
    </div>
  );
}
