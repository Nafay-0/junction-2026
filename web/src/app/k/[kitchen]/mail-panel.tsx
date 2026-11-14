"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { api } from "../../_client/api";
import { useLang, useText } from "../../_i18n/provider";
import { Button, Card, IconDisc, Input } from "../../_ui/kit";
import { usePortal } from "./portal";
import { MAIL_PANEL_TEXT } from "./mail-panel.text";
import type { AddressView } from "@/server/notify/service";

/**
 * Order emails on Agent and rules (server/notify): the kitchen's one notification address, its own choice. Given here
 * (or in words in the conversation), confirmed from the mail, changed or removed at any time. The full address is
 * shown only to the kitchen's own signed-in account.
 */
export function MailPanel({ own }: { own: boolean }) {
  const { kitchen } = usePortal();
  const tx = useText(MAIL_PANEL_TEXT);
  const { lang } = useLang();
  const path = `/ui-api/kitchens/${kitchen.slug}/mail`;
  const [v, setV] = useState<AddressView>();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  useEffect(() => {
    void api<AddressView>("GET", path).then((r) => r.ok && setV(r.data));
  }, [path]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await api<AddressView>("POST", path, { action: "set", address, lang });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setV(r.data);
    setEditing(false);
    setAddress("");
    setTimeout(() => void api<AddressView>("GET", path).then((g) => g.ok && setV(g.data)), 3000);
  }
  /** The same address again: a new confirmation mail (capped per kitchen and per client address on the server). */
  async function resend() {
    if (!v?.address) return;
    setBusy(true);
    setError(undefined);
    const r = await api<AddressView & { confirmation?: { outcome: string } }>("POST", path, { action: "set", address: v.address, lang });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setV(r.data);
    // The send happens just after: read the outcome a moment later, so a refused send is said, not hidden.
    setTimeout(() => void api<AddressView>("GET", path).then((g) => {
      if (!g.ok) return;
      setV(g.data);
      setNote(g.data.confirmation?.outcome === "sent" ? tx.resent : undefined);
    }), 3000);
  }
  async function remove() {
    setBusy(true);
    const r = await api<AddressView>("POST", path, { action: "remove" });
    setBusy(false);
    if (r.ok) setV(r.data);
  }
  const shown = v?.address ?? v?.masked ?? "";
  const status = !v ? "" : v.state === "confirmed" ? tx.confirmed(shown) : v.state === "pending" ? tx.pending(shown) : v.state === "stopped" ? tx.stopped(v.masked ?? "") : v.state === "bounced" ? tx.bounced(v.masked ?? "") : tx.none;
  const live = v?.state === "confirmed" || v?.state === "pending";
  return (
    <section aria-labelledby="mail-title" id="mail">
      <Card pad>
        <h2 id="mail-title" className="flex items-center gap-3">
          <IconDisc size={40}>
            <Mail size={19} />
          </IconDisc>
          <span className="display text-[1.4rem] leading-tight">
            {tx.title}
          </span>
        </h2>
        <p className="mt-3 max-w-[68ch] leading-relaxed text-ink-soft">{tx.intro}</p>
        {v && (
          <p role="status" className="mt-4 font-medium">
            {status}
          </p>
        )}
        {v?.state === "pending" && (v.confirmation?.outcome === "failed" || v.confirmation?.outcome === "skipped") && (
          <p role="alert" className="mt-2 text-[0.92rem] font-medium leading-snug text-bad">
            {tx.notSent}
          </p>
        )}
        {note && <p className="mt-2 text-[0.9rem] text-good">{note}</p>}
        {v && !v.configured && <p className="mt-2 text-[0.9rem] text-ink-soft">{tx.notConfigured}</p>}
        {v?.configured && v.testSenderOnly && <p className="mt-2 text-[0.85rem] text-ink-soft">{tx.testSender}</p>}
        <p className="mt-2 text-[0.85rem] text-ink-soft">{tx.private}</p>
        {own ? (
          <div className="mt-5">
            {editing || (v && !live) ? (
              <form onSubmit={(e) => void save(e)} className="flex max-w-[520px] flex-col gap-3 sm:flex-row sm:items-end">
                <Input className="min-w-0 flex-1" label={tx.label} type="email" autoComplete="email" inputMode="email" required value={address} onChange={setAddress} error={error} />
                <Button kind="primary" type="submit" busy={busy} disabled={!v?.configured || !address.includes("@")}>
                  {tx.save}
                </Button>
              </form>
            ) : (
              live && (
                <div className="flex flex-wrap gap-3">
                  {v?.state === "pending" && v.address && (
                    <Button kind="primary" busy={busy} disabled={!v.configured} onClick={() => void resend()}>
                      {tx.resend}
                    </Button>
                  )}
                  <Button kind="secondary" onClick={() => setEditing(true)}>
                    {tx.change}
                  </Button>
                  <Button kind="secondary" busy={busy} onClick={() => void remove()}>
                    {tx.remove}
                  </Button>
                </div>
              )
            )}
          </div>
        ) : (
          <p className="mt-4 text-[0.9rem] text-ink-soft">{tx.onlyOwn}</p>
        )}
      </Card>
    </section>
  );
}
