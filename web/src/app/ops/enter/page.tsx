import type { Metadata } from "next";
import { Suspense } from "react";
import { opsMode } from "@/server/ops/access";
import { connection } from "next/server";
import { Entry } from "./entry";

export const metadata: Metadata = { title: "Enter operations · Dock" };

/** One click into the wholesaler's operations portal (or a passcode, when DOCK_OPS_PASSCODE is set). */
export default function EnterPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-steel" />}>
      <Loaded />
    </Suspense>
  );
}

async function Loaded() {
  await connection();
  return <Entry mode={opsMode()} />;
}
