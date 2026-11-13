"use client";

import { useState } from "react";
import type { PublicOrder } from "@/core/orders";
import { CallAgent } from "./call-screen";
import { ScanDoor } from "./scan-door";

/** Sign-off for a demo kitchen: its approver is fictional, so the console's QR code stands in for their phone. */
function DemoSignOff({ kitchen, order }: { kitchen: string; order: PublicOrder }) {
  const [qr, setQr] = useState<{ url: string; qrSvg: string } | null | "none">(null);
  const id = order.approval?.approvalId;
  if (!id) return null;
  if (qr === null) {
    void fetch(`/ui-api/kitchens/${encodeURIComponent(kitchen)}/approval/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setQr(d?.qrSvg ? { url: d.url, qrSvg: d.qrSvg } : "none"))
      .catch(() => setQr("none"));
    return <p className="text-sm text-ink-soft">Loading the sign-off code…</p>;
  }
  if (qr === "none") return <p className="text-sm text-ink-soft">The sign-off request is on the approver&apos;s phone.</p>;
  return (
    <div className="flex items-center gap-3">
      <div className="size-36 shrink-0 bg-paper p-1" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} />
      <p className="text-sm">
        Scan to sign off as the approver, or{" "}
        <a className="underline" href={qr.url} target="_blank" rel="noreferrer">
          open the sign-off page
        </a>
        .
      </p>
    </div>
  );
}

export function DoorsPreview({ kitchen }: { kitchen: string }) {
  const signOff = (o: PublicOrder) => <DemoSignOff kitchen={kitchen} order={o} />;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <section className="rounded-xl border-[3px] border-ink bg-paper p-4">
        <h2 className="font-display text-2xl font-bold">Voice: call the agent</h2>
        <p className="mt-1 text-[1.02rem] text-ink-soft">Hands full: hold the button and say what is needed, in English, Finnish or Swedish. The agent answers by voice and the same cards appear.</p>
        <div className="mt-4">
          <CallAgent kitchen={kitchen} renderSignOff={signOff} />
        </div>
      </section>
      <section className="rounded-xl border-[3px] border-ink bg-paper p-4">
        <h2 className="font-display text-2xl font-bold">Photo or document</h2>
        <p className="mt-1 text-[1.02rem] text-ink-soft">A whiteboard, a handwritten list, a PDF or an email: every line read, checked by you, then sent through the same flow.</p>
        <div className="mt-4">
          <ScanDoor kitchen={kitchen} renderSignOff={signOff} />
        </div>
      </section>
    </div>
  );
}
