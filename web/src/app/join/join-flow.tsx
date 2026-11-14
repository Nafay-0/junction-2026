"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../_client/api";
import { useLang } from "../_i18n/provider";
import { passkeyProblemL } from "../_ui/passkey.text";
import { fiMoney } from "../_ui/plain";
import { Lock, ScanFace, ShieldCheck, Smartphone, Timer, Users, WifiOff } from "lucide-react";
import { Avatar, Card, IconDisc, Spinner } from "../_ui/kit";
import { PhoneNotice, PhoneProblem, PhoneSkeleton, bigButton } from "../_ui/phone";
import { JOIN_TEXT } from "./join-flow.text";
import { placeNameL } from "../_i18n/kitchen-words";

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

  if (phase === "loading") return <PhoneSkeleton label={tx.loading} />;
  if (phase === "full" || phase === "offline")
    return (
      <PhoneNotice
        title={shown?.title ?? tx.offline}
        body={shown?.body ?? ""}
        mark={
          <IconDisc tone="muted" size={60}>
            {phase === "full" ? <Users size={26} /> : <WifiOff size={26} />}
          </IconDisc>
        }
      >
        <button className={`mt-auto ${bigButton("dark")}`} onClick={() => void load()}>
          {tx.tryAgain}
        </button>
      </PhoneNotice>
    );
  if (!start) return null;

  if (start.current && !skipCurrent)
    return (
      <PhoneNotice title={tx.already(start.current.approverName)} body={tx.alreadyBody(placeNameL(start.current.kitchenName, lang))} mark={<Avatar name={start.current.approverName} size={60} />}>
        <div className="mt-auto pt-8">
          <Link href="/approver" className={bigButton("go")}>
            {tx.goToMine}
          </Link>
          <button className={`mt-2.5 ${bigButton("secondary")}`} onClick={() => setSkipCurrent(true)}>
            {tx.startOver}
          </button>
        </div>
      </PhoneNotice>
    );

  const id = start.identity;
  const busy = phase === "prompt" || phase === "saving";
  const canPasskey = supported && start.secureOrigin;
  const icons = [ScanFace, Smartphone, ShieldCheck];
  return (
    <div className="flex flex-1 flex-col">
      <p className="inline-flex items-center gap-1.5 self-start rounded-full bg-petrol-soft px-3 py-1 text-[0.86rem] font-medium text-petrol-deep">
        <Timer aria-hidden size={15} />
        {tx.eyebrow}
      </p>
      <h1 className="display mt-4 text-[2.15rem] leading-[1.05] text-ink hyphens-manual [overflow-wrap:break-word]">{tx.title(placeNameL(id.kitchenName, lang), id.city)}</h1>
      <p className="mt-3 leading-relaxed text-ink-soft [&_strong]:font-semibold [&_strong]:text-ink">{tx.intro(<strong>{id.approverName}</strong>, <strong className="tabular">{fiMoney(start.perOrderLimit)}</strong>)}</p>

      <Card className="mt-6">
        <ol className="divide-y divide-line">
          {tx.steps.map((t, i) => {
            const Icon = icons[i] ?? ShieldCheck;
            return (
              <li key={t} className="flex items-start gap-3.5 px-4 py-3.5">
                <span className="relative shrink-0">
                  <IconDisc size={40}>
                    <Icon size={19} />
                  </IconDisc>
                  <span aria-hidden className="absolute -bottom-0.5 -right-0.5 flex size-[1.15rem] items-center justify-center rounded-full bg-petrol text-[0.68rem] font-semibold text-paper ring-2 ring-paper tabular">
                    {i + 1}
                  </span>
                </span>
                <span className="min-w-0 pt-2 leading-snug">{t}</span>
              </li>
            );
          })}
        </ol>
      </Card>
      <p className="mt-4 flex items-start gap-2 text-[0.9rem] leading-snug text-ink-soft">
        <Lock aria-hidden size={15} className="mt-[0.2em] shrink-0" />
        {tx.privacy}
      </p>

      {shown && phase === "failed" && <PhoneProblem title={shown.title} body={shown.body} quiet={problem?.key === "passkey" && passkeyProblemL(problem.err, lang).cancelled} />}
      {!canPasskey && <PhoneProblem quiet title={tx.noPasskeyTitle} body={start.secureOrigin ? tx.noPasskeyBrowser : tx.noPasskeyHttps} />}

      <div className="mt-auto pt-6">
        <div className="sticky bottom-0 -mx-4 bg-mist/95 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
        <button className={bigButton("go")} onClick={() => void createPasskey()} disabled={busy || !canPasskey}>
          {busy ? <Spinner size={18} /> : <ScanFace aria-hidden size={22} strokeWidth={2.1} />}
          {phase === "prompt" ? tx.waitingBio : phase === "saving" ? tx.settingUp : tx.create}
        </button>
        {start.demoTapEnabled && (phase === "failed" || !canPasskey) && (
          <button className={`mt-2.5 ${bigButton("demo")}`} disabled={busy} onClick={() => void finish({ fallback: true })}>
            {tx.demoTap}
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
