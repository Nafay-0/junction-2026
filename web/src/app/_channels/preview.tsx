"use client";

import { useState } from "react";
import type { PublicOrder } from "@/core/orders";
import { useText } from "../_i18n/provider";
import { CallAgent } from "./call-screen";
import { DOORS_TEXT } from "./doors.text";
import { ScanDoor } from "./scan-door";

/** Sign-off for a demo kitchen: its approver is fictional, so the console's QR code stands in for their phone. */
function DemoSignOff({ kitchen, order }: { kitchen: string; order: PublicOrder }) {
  const tx = useText(DOORS_TEXT);
  const [qr, setQr] = useState<{ url: string; qrSvg: string } | null | "none">(null);
  const id = order.approval?.approvalId;
  if (!id) return null;
  if (qr === null) {
    void fetch(`/ui-api/kitchens/${encodeURIComponent(kitchen)}/approval/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setQr(d?.qrSvg ? { url: d.url, qrSvg: d.qrSvg } : "none"))
      .catch(() => setQr("none"));
    return <p className="text-sm text-ink-soft">{tx.loadingCode}</p>;
  }
  if (qr === "none") return <p className="text-sm text-ink-soft">{tx.onApproverPhone}</p>;
  return (
    <div className="flex items-center gap-3">
      <div className="size-36 shrink-0 bg-paper p-1" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} />
      <p className="text-sm">
        {tx.scanToSign}
        <a className="underline" href={qr.url} target="_blank" rel="noreferrer">
          {tx.openSignOffPage}
        </a>
        .
      </p>
    </div>
  );
}

export function DoorsPreview({ kitchen }: { kitchen: string }) {
  const tx = useText(DOORS_TEXT);
  const signOff = (o: PublicOrder) => <DemoSignOff kitchen={kitchen} order={o} />;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <section className="rounded-xl border-[3px] border-ink bg-paper p-4">
        <h2 className="font-display text-2xl font-bold">{tx.voiceTitle}</h2>
        <p className="mt-1 text-[1.02rem] text-ink-soft">{tx.voiceIntro}</p>
        <div className="mt-4">
          <CallAgent kitchen={kitchen} renderSignOff={signOff} />
        </div>
      </section>
      <section className="rounded-xl border-[3px] border-ink bg-paper p-4">
        <h2 className="font-display text-2xl font-bold">{tx.photoTitle}</h2>
        <p className="mt-1 text-[1.02rem] text-ink-soft">{tx.photoIntro}</p>
        <div className="mt-4">
          <ScanDoor kitchen={kitchen} renderSignOff={signOff} />
        </div>
      </section>
    </div>
  );
}
