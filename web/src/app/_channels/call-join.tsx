"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../_client/api";
import { LangSwitch, useLang } from "../_i18n/provider";
import { passkeyProblemL } from "../_ui/passkey.text";
import { fiMoney } from "../_ui/plain";
import { DOORS_TEXT } from "./doors.text";

/**
 * The one step before a first call from a phone: become the purchasing manager of a fresh visitor kitchen, with
 * a passkey on this phone (the same join as /join, through the same API). Then the page reloads into the call,
 * so the kitchen called is the visitor's own and the sign-off for its order comes back to this phone.
 */
type Start = { options: PublicKeyCredentialCreationOptionsJSON; identity: { kitchenName: string; city: string; approverName: string; agentName: string }; perOrderLimit: string; secureOrigin: boolean; demoTapEnabled: boolean };

/** Kept as a kind, not as words, so the page follows a language switch. */
type Problem = { key: "full" | "offline" | "failed"; body: string } | { key: "passkey"; err: unknown };

export function CallJoin() {
  const router = useRouter();
  const { lang } = useLang();
  const tx = DOORS_TEXT[lang];
  const [start, setStart] = useState<Start | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    queueMicrotask(() => setSupported(browserSupportsWebAuthn() && window.isSecureContext));
    void api<Start>("POST", "/api/v1/join").then((r) => (r.ok ? setStart(r.data) : setProblem({ key: r.status === 503 ? "full" : "offline", body: r.error.message })));
  }, []);

  async function join(body?: unknown) {
    if (!start) return;
    setBusy(true);
    setProblem(null);
    let payload = body;
    if (!payload) {
      try {
        payload = { response: await startRegistration({ optionsJSON: start.options }) };
      } catch (err) {
        setProblem({ key: "passkey", err });
        setBusy(false);
        void api<Start>("POST", "/api/v1/join").then((r) => r.ok && setStart(r.data));
        return;
      }
    }
    const r = await api<{ next: string }>("POST", "/api/v1/join/verify", payload);
    if (r.ok) {
      router.refresh();
      return;
    }
    setProblem({ key: "failed", body: r.error.message });
    setBusy(false);
  }

  const shown = !problem ? null : problem.key === "passkey" ? passkeyProblemL(problem.err, lang) : { title: tx[problem.key], body: problem.body };
  if (!start && !problem) return <p className="mt-20 text-center text-[1.15rem] text-ink-soft">{tx.settingUp}</p>;
  const id = start?.identity;
  return (
    <div className="flex min-h-dvh flex-col px-5 py-8 text-ink">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[0.95rem] font-semibold text-petrol">{tx.synthetic}</p>
        <LangSwitch />
      </div>
      {id && (
        <>
          <h1 className="mt-2 display text-[2.4rem] leading-[0.98] hyphens-auto [overflow-wrap:anywhere]">{tx.joinTitle(id.kitchenName, id.city)}</h1>
          <p className="mt-4 text-[1.15rem]">{tx.joinIntro(<strong>{id.approverName}</strong>, lang === "en" ? start!.perOrderLimit : fiMoney(start!.perOrderLimit))}</p>
          <p className="mt-3 text-base text-ink-soft">{tx.joinPasskey}</p>
        </>
      )}
      {shown && (
        <div role="alert" className="mt-6 border-[3px] border-ink bg-paper p-4">
          <p className="font-semibold">{shown.title}</p>
          <p className="mt-1">{shown.body}</p>
        </div>
      )}
      {start && !(supported && start.secureOrigin) && (
        <p role="alert" className="mt-6 border-2 border-ink bg-paper p-4">
          {start.secureOrigin ? tx.noPasskeyBrowser : tx.noPasskeyHttps}
        </p>
      )}
      <div className="mt-auto space-y-3 pt-8">
        <button type="button" disabled={busy || !start || !(supported && start.secureOrigin)} onClick={() => void join()} className="min-h-16 w-full bg-lime text-xl font-semibold text-ink disabled:opacity-50">
          {busy ? tx.oneMoment : tx.createAndCall}
        </button>
        {start?.demoTapEnabled && (
          <button type="button" disabled={busy} onClick={() => void join({ fallback: true })} className="min-h-12 w-full border-2 border-dashed border-ink-soft text-base">
            {tx.demoJoin}
          </button>
        )}
      </div>
    </div>
  );
}
