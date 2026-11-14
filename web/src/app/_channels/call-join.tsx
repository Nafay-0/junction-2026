"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, passkeyProblem } from "../_client/api";

/**
 * The one step before a first call from a phone: become the purchasing manager of a fresh visitor kitchen, with
 * a passkey on this phone (the same join as /join, through the same API). Then the page reloads into the call,
 * so the kitchen called is the visitor's own and the sign-off for its order comes back to this phone.
 */
type Start = { options: PublicKeyCredentialCreationOptionsJSON; identity: { kitchenName: string; city: string; approverName: string; agentName: string }; perOrderLimit: string; secureOrigin: boolean; demoTapEnabled: boolean };

export function CallJoin() {
  const router = useRouter();
  const [start, setStart] = useState<Start | null>(null);
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    queueMicrotask(() => setSupported(browserSupportsWebAuthn() && window.isSecureContext));
    void api<Start>("POST", "/api/v1/join").then((r) => (r.ok ? setStart(r.data) : setProblem({ title: r.status === 503 ? "The demo is full" : "Can't reach AimoPilot", body: r.error.message })));
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
        setProblem(passkeyProblem(err));
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
    setProblem({ title: "That didn't work", body: r.error.message });
    setBusy(false);
  }

  if (!start && !problem) return <p className="mt-20 text-center text-[1.15rem] text-ink-soft">Setting up your kitchen…</p>;
  const id = start?.identity;
  return (
    <div className="flex min-h-dvh flex-col px-5 py-8 text-ink">
      <p className="text-[0.95rem] font-semibold text-petrol">A demo on synthetic data</p>
      {id && (
        <>
          <h1 className="mt-2 display text-[2.4rem] leading-[0.98]">Call the purchasing agent of {id.kitchenName}, {id.city}</h1>
          <p className="mt-4 text-[1.15rem]">
            First, one tap makes you <strong>{id.approverName}</strong>, the kitchen&apos;s purchasing manager. The agent may spend up to {start!.perOrderLimit} per order alone; anything more comes back to this phone for your sign-off.
          </p>
          <p className="mt-3 text-base text-ink-soft">The tap creates a passkey (Face ID, fingerprint or PIN). No name, email or password. It is deleted when the demo kitchen closes.</p>
        </>
      )}
      {problem && (
        <div role="alert" className="mt-6 border-[3px] border-ink bg-paper p-4">
          <p className="font-semibold">{problem.title}</p>
          <p className="mt-1">{problem.body}</p>
        </div>
      )}
      {start && !(supported && start.secureOrigin) && (
        <p role="alert" className="mt-6 border-2 border-ink bg-paper p-4">
          {start.secureOrigin ? "This browser can't create passkeys. Try Safari on iPhone or Chrome on Android." : "Passkeys only work over https. Open the https address of this demo."}
        </p>
      )}
      <div className="mt-auto space-y-3 pt-8">
        <button type="button" disabled={busy || !start || !(supported && start.secureOrigin)} onClick={() => void join()} className="min-h-16 w-full bg-lime text-xl font-semibold text-ink disabled:opacity-50">
          {busy ? "One moment…" : "Create passkey and call"}
        </button>
        {start?.demoTapEnabled && (
          <button type="button" disabled={busy} onClick={() => void join({ fallback: true })} className="min-h-12 w-full border-2 border-dashed border-ink-soft text-base">
            Demo only: join without a passkey
          </button>
        )}
      </div>
    </div>
  );
}
