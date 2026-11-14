"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../_client/api";
import { useText } from "../../_i18n/provider";
import { Button, Card, ErrorPlate, IconDisc, Input } from "../../_ui/kit";
import { usePortal } from "./portal";
import { START_OVER_TEXT } from "./start-over.text";

/**
 * A demo account's "Start over" and "Delete this account" (server/demo/service.ts), each with its confirmation in
 * the page. Start over is a new kitchen with the rules signed at onboarding and the same starting point; the ledger
 * keeps everything and records the reset.
 */
export function StartOver({ sample }: { sample: boolean }) {
  const { kitchen, base, account } = usePortal();
  const tx = useText(START_OVER_TEXT);
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"restart" | "delete">();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [typed, setTyped] = useState("");
  const url = `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/demo`;

  async function restart() {
    setBusy("restart");
    setError(undefined);
    const r = await api("POST", url, { action: "restart" });
    setBusy(undefined);
    setAsking(false);
    if (!r.ok) return setError(r.error.message);
    setDone(true);
    // The kitchen is a new one: reload so every page reads it afresh.
    setTimeout(() => {
      router.push(base);
      router.refresh();
    }, 900);
  }
  async function remove() {
    setBusy("delete");
    setError(undefined);
    const r = await api("POST", url, { action: "delete", confirm: typed.trim() });
    if (!r.ok) {
      setBusy(undefined);
      return setError(r.error.message);
    }
    router.push("/k");
    router.refresh();
  }

  return (
    <section id="start-over" aria-labelledby="start-over-title" className="scroll-mt-28">
      <Card pad className="space-y-5">
        <div>
          <div className="flex items-center gap-3">
            <IconDisc size={40} tone="muted">
              <RotateCcw size={18} />
            </IconDisc>
            <h2 id="start-over-title" className="display min-w-0 text-[1.45rem] leading-tight">
              {tx.title}
            </h2>
          </div>
          <p className="mt-3 max-w-[64ch] leading-relaxed text-ink-soft">{tx.intro(sample)}</p>
          <Link href={`${base}/guide`} className="mt-1 inline-flex min-h-11 items-center font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
            {tx.guide}
          </Link>
        </div>
        {done && (
          <p role="status" className="rounded-md bg-good-soft px-3.5 py-2.5 text-[0.95rem] leading-snug text-good">
            {tx.done}
          </p>
        )}
        {!asking ? (
          <Button kind="secondary" onClick={() => setAsking(true)} disabled={!!busy}>
            <RotateCcw aria-hidden size={16} />
            {tx.start}
          </Button>
        ) : (
          <div role="alertdialog" aria-labelledby="restart-ask" className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <p id="restart-ask" className="font-semibold">
              {tx.confirmTitle}
            </p>
            <p className="text-[0.95rem] leading-snug text-ink-soft">{tx.confirmBody}</p>
            <div className="flex flex-wrap gap-2.5">
              <Button kind="primary" busy={busy === "restart"} disabled={!!busy} onClick={() => void restart()}>
                {busy === "restart" ? tx.working : tx.confirm}
              </Button>
              <Button kind="quiet" disabled={!!busy} onClick={() => setAsking(false)}>
                {tx.cancel}
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-3 border-t border-line pt-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Trash2 aria-hidden size={17} className="text-bad" />
            {tx.deleteTitle}
          </h3>
          <p className="max-w-[64ch] text-[0.95rem] leading-snug text-ink-soft">{tx.deleteIntro}</p>
          <Input label={tx.deleteAsk(account?.username ?? "")} value={typed} onChange={setTyped} autoComplete="off" name="confirm-delete" />
          <Button kind="safety" busy={busy === "delete"} disabled={!!busy || typed.trim() !== account?.username} onClick={() => void remove()}>
            {busy === "delete" ? tx.deleting : tx.deleteButton}
          </Button>
        </div>
        {error && <ErrorPlate title={tx.title} message={error} />}
      </Card>
    </section>
  );
}
