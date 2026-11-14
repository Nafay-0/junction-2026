"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../_client/api";
import { useLang } from "../_i18n/provider";
import { passkeyProblemL } from "../_ui/passkey.text";
import { fiMoney } from "../_ui/plain";
import { PhoneNotice, PhoneProblem, bigButton } from "../_ui/phone";
import { JOIN_TEXT } from "./join-flow.text";

type Identity = { kitchenName: string; city: string; approverName: string; agentName: string };
type Start = {
  options: PublicKeyCredentialCreationOptionsJSON;
  identity: Identity;
  perOrderLimit: string;
  current?: { kitchenName: string; approverName: string; expiresAt: string };
  secureOrigin: boolean;
  demoTapEnabled: boolean;
};

/** Kept as a kind, not as words, so the page follows a language switch. */
type Problem = { key: "full" | "offline" | "failed"; body: string } | { key: "passkey"; err: unknown };

type Phase = "loading" | "ready" | "prompt" | "saving" | "failed" | "full" | "offline";

const REFRESH_MS = 4 * 60_000; // prompts expire after 5 minutes on the server

export function JoinFlow() {
  const router = useRouter();
  const { lang } = useLang();
  const tx = JOIN_TEXT[lang];
  const [start, setStart] = useState<Start | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [problem, setProblem] = useState<Problem | null>(null);
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
    setProblem({ key: r.status === 503 ? "full" : "offline", body: r.error.message });
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
    setProblem({ key: "failed", body: r.error.message });
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
      setProblem({ key: "passkey", err });
      setPhase("failed");
      if (Date.now() - fetchedAt.current > REFRESH_MS) void load();
      return;
    }
    await finish({ response });
  }

  const shown = !problem ? null : problem.key === "passkey" ? passkeyProblemL(problem.err, lang) : { title: tx[problem.key], body: problem.body };

  if (phase === "loading") return <p className="mt-20 text-center text-ink-soft">{tx.loading}</p>;
  if (phase === "full" || phase === "offline")
    return (
      <PhoneNotice title={shown?.title ?? tx.offline} body={shown?.body ?? ""}>
        <button className={`mt-6 ${bigButton("dark")}`} onClick={() => void load()}>
          {tx.tryAgain}
        </button>
      </PhoneNotice>
    );
  if (!start) return null;

  if (start.current && !skipCurrent)
    return (
      <PhoneNotice title={tx.already(start.current.approverName)} body={tx.alreadyBody(start.current.kitchenName)}>
        <Link href="/approver" className={`mt-6 ${bigButton("go")}`}>
          {tx.goToMine}
        </Link>
        <button className={`mt-3 ${bigButton("secondary")} min-h-14 text-[1.05rem]`} onClick={() => setSkipCurrent(true)}>
          {tx.startOver}
        </button>
      </PhoneNotice>
    );

  const id = start.identity;
  const busy = phase === "prompt" || phase === "saving";
  const canPasskey = supported && start.secureOrigin;
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-[1rem] font-semibold text-petrol">{tx.eyebrow}</p>
      <h1 className="display mt-2 text-[2.6rem] leading-[0.98] text-ink hyphens-auto [overflow-wrap:anywhere]">{tx.title(id.kitchenName, id.city)}</h1>
      <div className="mt-5 bg-paper p-4">
        <p className="leading-snug">{tx.intro(<strong>{id.approverName}</strong>, <strong className="tabular">{fiMoney(start.perOrderLimit)}</strong>)}</p>
      </div>
      <ol className="mt-5 space-y-3">
        {tx.steps.map((t, i) => (
          <li key={t} className="grid grid-cols-[2rem_1fr] items-baseline gap-2 leading-snug">
            <span className="display flex size-7 items-center justify-center border-2 border-petrol text-[1rem] text-petrol">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[0.95rem] leading-snug text-ink-soft">{tx.privacy}</p>

      {shown && phase === "failed" && <PhoneProblem title={shown.title} body={shown.body} />}
      {!canPasskey && <PhoneProblem quiet title={tx.noPasskeyTitle} body={start.secureOrigin ? tx.noPasskeyBrowser : tx.noPasskeyHttps} />}

      <div className="mt-auto pt-8">
        <button className={bigButton("go")} onClick={() => void createPasskey()} disabled={busy || !canPasskey}>
          {phase === "prompt" ? tx.waitingBio : phase === "saving" ? tx.settingUp : tx.create}
        </button>
        {start.demoTapEnabled && (phase === "failed" || !canPasskey) && (
          <button className={`mt-3 ${bigButton("demo")} min-h-14 text-[1rem]`} disabled={busy} onClick={() => void finish({ fallback: true })}>
            {tx.demoTap}
          </button>
        )}
      </div>
    </div>
  );
}
