"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, passkeyProblem } from "../_client/api";

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

  if (phase === "loading") return <p className="mt-20 text-center text-neutral-600">Setting up your kitchen…</p>;
  if (phase === "full" || phase === "offline")
    return (
      <Notice title={problem?.title ?? "Can't reach Dock"} body={problem?.body ?? ""}>
        <button className="mt-6 h-14 w-full rounded-xl bg-neutral-900 text-lg font-semibold text-white" onClick={() => void load()}>
          Try again
        </button>
      </Notice>
    );
  if (!start) return null;

  if (start.current && !skipCurrent)
    return (
      <Notice title={`You are already ${start.current.approverName}`} body={`Purchasing manager at ${start.current.kitchenName}.`}>
        <Link href="/approver" className="mt-6 flex h-14 w-full items-center justify-center rounded-xl bg-neutral-900 text-lg font-semibold text-white">
          Go to my screen
        </Link>
        <button className="mt-3 h-12 w-full rounded-xl border border-neutral-300 text-base" onClick={() => setSkipCurrent(true)}>
          Start over with a new kitchen
        </button>
      </Notice>
    );

  const id = start.identity;
  const busy = phase === "prompt" || phase === "saving";
  const canPasskey = supported && start.secureOrigin;
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-base font-medium uppercase tracking-wide text-neutral-500">Dock demo</p>
      <h1 className="mt-2 text-3xl font-bold leading-tight">
        Become the purchasing manager of {id.kitchenName}, {id.city}
      </h1>
      <p className="mt-4">
        You will be <strong>{id.approverName}</strong>. The kitchen&apos;s AI buyer may spend up to {start.perOrderLimit} per order on its own. Anything bigger, or any
        swap to a different product, comes to this phone for your OK.
      </p>
      <p className="mt-4 text-base text-neutral-600">
        One tap creates a passkey on this phone: Face ID or your fingerprint, no name, no email, no password. It is deleted from Dock when the demo kitchen closes.
      </p>

      {problem && phase === "failed" && (
        <div role="alert" className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="font-semibold text-red-900">{problem.title}</p>
          <p className="mt-1 text-base text-red-900">{problem.body}</p>
        </div>
      )}
      {!canPasskey && (
        <div role="alert" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-950">
          {start.secureOrigin ? "This browser can't create passkeys. Try Safari on iPhone or Chrome on Android." : "Passkeys only work over https. Open the https address of this demo."}
        </div>
      )}

      <div className="mt-auto pt-8">
        <button
          className="h-16 w-full rounded-2xl bg-green-700 text-xl font-semibold text-white disabled:opacity-50"
          onClick={() => void createPasskey()}
          disabled={busy || !canPasskey}
        >
          {phase === "prompt" ? "Waiting for Face ID or fingerprint…" : phase === "saving" ? "Setting up…" : "Create my passkey and start"}
        </button>
        {start.demoTapEnabled && (phase === "failed" || !canPasskey) && (
          <button className="mt-3 h-14 w-full rounded-2xl border-2 border-dashed border-amber-500 text-base text-amber-900" disabled={busy} onClick={() => void finish({ fallback: true })}>
            Demo only: continue without a passkey (your approvals will be marked unverified)
          </button>
        )}
      </div>
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mt-16">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-3">{body}</p>
      {children}
    </div>
  );
}
