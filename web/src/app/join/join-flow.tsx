"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, passkeyProblem } from "../_client/api";
import { fiMoney } from "../_ui/plain";
import { PhoneNotice, PhoneProblem, bigButton } from "../_ui/phone";

type Identity = { kitchenName: string; city: string; approverName: string; agentName: string };
type Start = {
  options: PublicKeyCredentialCreationOptionsJSON;
  identity: Identity;
  perOrderLimit: string;
  current?: { kitchenName: string; approverName: string; expiresAt: string };
  secureOrigin: boolean;
  demoTapEnabled: boolean;
};

type Phase = "loading" | "ready" | "prompt" | "saving" | "failed" | "full" | "offline";

const REFRESH_MS = 4 * 60_000; // prompts expire after 5 minutes on the server

export function JoinFlow() {
  const router = useRouter();
  const [start, setStart] = useState<Start | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);
  const [supported, setSupported] = useState(true);
  const [skipCurrent, setSkipCurrent] = useState(false);
  const fetchedAt = useRef(0);

  const load = useCallback(async () => {
    const r = await api<Start>("POST", "/api/v1/join");
    if (r.ok) {
      fetchedAt.current = Date.now();
      setStart(r.data);
      setPhase((p) => (p === "loading" || p === "offline" ? "ready" : p));
      return;
    }
    setProblem({ title: r.status === 503 ? "The demo is full" : "Can't reach Dock", body: r.error.message });
    setPhase(r.status === 503 ? "full" : "offline");
  }, []);

  useEffect(() => {
    // Feature detection must run in the browser; the passkey prompt is prepared before the tap (Safari needs the
    // prompt to open straight from the tap, with no network round trip in between).
    const ok = browserSupportsWebAuthn() && window.isSecureContext;
    queueMicrotask(() => {
      setSupported(ok);
      void load();
    });
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function finish(body: unknown) {
    setPhase("saving");
    const r = await api<{ next: string }>("POST", "/api/v1/join/verify", body);
    if (r.ok) {
      router.replace(r.data.next);
      return;
    }
    setProblem({ title: "That didn't work", body: r.error.message });
    setPhase("failed");
    void load(); // the prompt was used up; prepare a fresh one
  }

  async function createPasskey() {
    if (!start) return;
    setProblem(null);
    setPhase("prompt");
    let response;
    try {
      response = await startRegistration({ optionsJSON: start.options });
    } catch (err) {
      setProblem(passkeyProblem(err));
      setPhase("failed");
      if (Date.now() - fetchedAt.current > REFRESH_MS) void load();
      return;
    }
    await finish({ response });
  }

  if (phase === "loading") return <p className="mt-20 text-center text-ink-soft">Setting up your kitchen…</p>;
  if (phase === "full" || phase === "offline")
    return (
      <PhoneNotice title={problem?.title ?? "Can't reach Dock"} body={problem?.body ?? ""}>
        <button className={`mt-6 ${bigButton("dark")}`} onClick={() => void load()}>
          Try again
        </button>
      </PhoneNotice>
    );
  if (!start) return null;

  if (start.current && !skipCurrent)
    return (
      <PhoneNotice title={`You are already ${start.current.approverName}`} body={`Purchasing manager at ${start.current.kitchenName}.`}>
        <Link href="/approver" className={`mt-6 ${bigButton("go")}`}>
          Go to my screen
        </Link>
        <button className={`mt-3 ${bigButton("secondary")} min-h-14 text-[1.05rem]`} onClick={() => setSkipCurrent(true)}>
          Start over with a new kitchen
        </button>
      </PhoneNotice>
    );

  const id = start.identity;
  const busy = phase === "prompt" || phase === "saving";
  const canPasskey = supported && start.secureOrigin;
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-[1rem] font-semibold text-petrol">A demo kitchen, yours for 90 minutes</p>
      <h1 className="display mt-2 text-[2.6rem] leading-[0.98] text-ink">
        Become the purchasing manager of {id.kitchenName}, {id.city}
      </h1>
      <div className="mt-5 bg-paper p-4">
        <p className="leading-snug">
          You will be <strong>{id.approverName}</strong>. The kitchen&apos;s AI buyer may spend up to <strong className="tabular">{fiMoney(start.perOrderLimit)}</strong> per order on its own. Anything bigger, or any swap to a different product, stops at the gate and comes to this phone for your OK.
        </p>
      </div>
      <ol className="mt-5 space-y-3">
        {["Create a passkey: one tap, Face ID or fingerprint.", "Keep this screen open.", "When the agent goes beyond its limit, the request opens here. You approve or decline."].map((t, i) => (
          <li key={t} className="grid grid-cols-[2rem_1fr] items-baseline gap-2 leading-snug">
            <span className="display flex size-7 items-center justify-center border-2 border-petrol text-[1rem] text-petrol">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[0.95rem] leading-snug text-ink-soft">No name, no email, no password. The passkey is deleted from Dock when the demo kitchen closes.</p>

      {problem && phase === "failed" && <PhoneProblem title={problem.title} body={problem.body} />}
      {!canPasskey && <PhoneProblem quiet title="Passkeys are not available here" body={start.secureOrigin ? "This browser can't create passkeys. Try Safari on iPhone or Chrome on Android." : "Passkeys only work over https. Open the https address of this demo."} />}

      <div className="mt-auto pt-8">
        <button className={bigButton("go")} onClick={() => void createPasskey()} disabled={busy || !canPasskey}>
          {phase === "prompt" ? "Waiting for Face ID or fingerprint…" : phase === "saving" ? "Setting up…" : "Create my passkey and start"}
        </button>
        {start.demoTapEnabled && (phase === "failed" || !canPasskey) && (
          <button className={`mt-3 ${bigButton("demo")} min-h-14 text-[1rem]`} disabled={busy} onClick={() => void finish({ fallback: true })}>
            Demo only: continue without a passkey (your approvals will be marked unverified)
          </button>
        )}
      </div>
    </div>
  );
}
