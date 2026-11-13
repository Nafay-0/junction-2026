import type { Metadata } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { Suspense } from "react";
import { joinLink } from "@/server/approval-links";
import { getRuntime } from "@/server/runtime";
import { wallSnapshot } from "@/server/wall-snapshot";
import { Wall } from "./_wall/wall";

export const metadata: Metadata = { title: "Dock: live at the gate" };

/** The wall: the big screen at the table. Rendered with a live snapshot so it is never empty, then kept live. */
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-steel" />}>
      <LiveWall />
    </Suspense>
  );
}

async function LiveWall() {
  await connection(); // request-time data: never prerender
  const [snapshot, join] = await Promise.all([getRuntime().then(wallSnapshot), joinLink(await headers())]);
  return <Wall initial={snapshot} join={{ url: join.url, qrSvg: join.qrSvg }} />;
}
