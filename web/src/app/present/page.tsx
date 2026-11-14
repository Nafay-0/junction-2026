import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { publicBaseUrl } from "@/server/config";
import { ATTACKS } from "@/server/show/attacks";
import { pageOps } from "@/server/show/page-access";
import { crashBoard } from "../_wall/crash-board";
import { Presenter } from "../_show/presenter";
import { ShowSignIn } from "../_show/sign-in";

export const metadata: Metadata = { title: "Presenter" };

/** Presenter mode: the three-minute story from one keyboard, behind the operations passcode. */
export default function PresentPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-petrol-deep" />}>
      <Present />
    </Suspense>
  );
}

async function Present() {
  await connection();
  const { staff, mode } = await pageOps();
  if (!staff) return <ShowSignIn mode={mode} what="Presenter mode" />;
  const base = publicBaseUrl(await headers());
  return <Presenter board={crashBoard()} attacks={ATTACKS.filter((a) => a.id !== "resume")} publicUrl={base.replace(/^https?:\/\//, "")} staff={staff.name} />;
}
