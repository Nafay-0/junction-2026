"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Sparkles } from "lucide-react";
import { api } from "../../_client/api";
import { useLang, useText } from "../../_i18n/provider";
import { moneyShort } from "../../_ui/plain";
import { Button, Card, ErrorPlate, IconDisc, Input } from "../../_ui/kit";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { usePortal } from "./portal";
import { FRESH_TEXT } from "./fresh.text";

/** A fresh kitchen's free play is a per-order amount no play reaches (server/demo/fresh.ts FREE_TERMS). */
export const noLimitOf = (perOrderLimitCents: number) => perOrderLimitCents >= 5_000_000;

/**
 * A fresh kitchen under Your rules (server/demo/fresh.ts): what its free play means in one line, its name (renamed in
 * one tap), "Keep it" with a sign-in name and password, and "Give this kitchen a limit" (this browser's passkey
 * becomes the approver, so an order over 250 € waits for an OK here too).
 */
export function FreshPanel() {
  const { kitchen, account } = usePortal();
  const tx = useText(FRESH_TEXT);
  const { lang } = useLang();
  const router = useRouter();
  const url = `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/demo`;
  const [name, setName] = useState(account?.restaurant ?? "");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const kept = account?.free?.kept;
  const noLimit = noLimitOf(kitchen.mandate.perOrderLimitCents);

  async function act(id: string, body: Record<string, unknown>, done: (d: Record<string, unknown>) => string) {
    setBusy(id);
    setError(undefined);
    setNote(undefined);
    const r = await api<Record<string, unknown>>("POST", url, body);
    setBusy(undefined);
    if (!r.ok) return setError(r.error.message);
    setNote(done(r.data));
    router.refresh();
  }
  /** The limit needs this browser's passkey as the approver first: added here if it has none. */
  async function limit() {
    setBusy("limit");
    setError(undefined);
    const d = await api<{ devices: unknown[] }>("GET", "/ui-api/account/device");
    if (d.ok && d.data.devices.length === 0) {
      if (!browserSupportsWebAuthn()) {
        setBusy(undefined);
        return setError(passkeyProblemL(new Error("unsupported"), lang).body);
      }
      const begin = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("POST", "/ui-api/account/device", { step: "begin" });
      if (!begin.ok) {
        setBusy(undefined);
        return setError(begin.error.message);
      }
      try {
        const response = await startRegistration({ optionsJSON: begin.data.options });
        const v = await api("POST", "/ui-api/account/device", { step: "verify", response });
        if (!v.ok) {
          setBusy(undefined);
          return setError(v.error.message);
        }
      } catch (err) {
        setBusy(undefined);
        return setError(passkeyProblemL(err, lang).body);
      }
    }
    await act("limit", { action: "limit" }, () => tx.limitDone);
  }

  return (
    <section id="fresh" aria-labelledby="fresh-title" className="scroll-mt-28">
      <Card pad className="space-y-5">
        <div>
          <div className="flex items-center gap-3">
            <IconDisc size={40} tone="good">
              <Sparkles size={18} />
            </IconDisc>
            <h2 id="fresh-title" className="display min-w-0 text-[1.45rem] leading-tight">
              {tx.title}
            </h2>
          </div>
          <p className="mt-3 text-[1.05rem] font-semibold leading-snug" data-testid="fresh-limits">
            {noLimit ? tx.noLimits : tx.limitSet(moneyShort(kitchen.mandate.perOrderLimitCents))}
          </p>
          <p className="mt-2 max-w-[70ch] text-[0.95rem] leading-relaxed text-ink-soft">{tx.free}</p>
          <p className="mt-2 text-[0.88rem] text-ink-soft">
            {tx.signerLine} {kept ? tx.kept : tx.lives}
          </p>
        </div>
        <form
          className="flex flex-col gap-2.5 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void act("rename", { action: "rename", name }, () => tx.renamed);
          }}
        >
          <Input className="min-w-0 flex-1" label={tx.name} value={name} onChange={setName} maxLength={80} />
          <Button kind="secondary" type="submit" busy={busy === "rename"} disabled={!!busy || name.trim().length < 2}>
            {tx.rename}
          </Button>
        </form>
        {noLimit && (
          <div className="space-y-2 border-t border-line pt-5">
            <h3 className="font-semibold">{tx.limitTitle}</h3>
            <p className="max-w-[64ch] text-[0.95rem] leading-snug text-ink-soft">{tx.limitIntro}</p>
            <Button kind="primary" busy={busy === "limit"} disabled={!!busy} onClick={() => void limit()}>
              {busy !== "limit" && <KeyRound aria-hidden size={16} />}
              {busy === "limit" ? tx.working : tx.limitButton}
            </Button>
          </div>
        )}
        {!kept && (
          <form
            className="space-y-3 border-t border-line pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void act("keep", { action: "keep", login, password }, (d) => tx.keptDone(String(d.login ?? login)));
            }}
          >
            <h3 className="font-semibold">{tx.keepTitle}</h3>
            <p className="max-w-[64ch] text-[0.95rem] leading-snug text-ink-soft">{tx.keepIntro}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={tx.login} value={login} onChange={setLogin} autoComplete="username" maxLength={32} />
              <Input label={tx.password} type="password" value={password} onChange={setPassword} autoComplete="new-password" maxLength={200} />
            </div>
            <Button kind="secondary" type="submit" busy={busy === "keep"} disabled={!!busy || login.trim().length < 3 || password.length < 10}>
              {tx.keepButton}
            </Button>
          </form>
        )}
        {note && (
          <p role="status" className="rounded-md bg-good-soft px-3.5 py-2.5 text-[0.95rem] leading-snug text-good">
            {note}
          </p>
        )}
        {error && <ErrorPlate title={tx.title} message={error} />}
      </Card>
    </section>
  );
}
