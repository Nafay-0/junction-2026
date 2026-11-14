import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { joinLink } from "@/server/approval-links";
import { pageOps } from "@/server/show/page-access";
import { ShowSignIn } from "../../_show/sign-in";
import { Table } from "../../_show/table";

export const metadata: Metadata = { title: "At the table" };

/** Table mode: the QR code on the wall; each visitor who joins gets their own kitchen's week, signed on their phone. */
export default function TablePage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-petrol-deep" />}>
      <TableView />
    </Suspense>
  );
}

async function TableView() {
  await connection();
  const { staff, mode } = await pageOps();
  if (!staff) return <ShowSignIn mode={mode} what="Table mode" />;
  const join = await joinLink(await headers());
  return <Table joinUrl={join.url} qrSvg={join.qrSvg} />;
}
