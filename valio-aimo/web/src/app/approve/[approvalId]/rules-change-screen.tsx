"use client";

import { browserSupportsWebAuthn, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleSlash, CircleX, Clock, Hourglass, ScanFace, ShieldCheck, UserRound } from "lucide-react";
import type { RulesChangeView } from "@/server/thread/rules-signoff";
import { api, type ApiError } from "../../_client/api";
import type { Lang } from "../../_i18n/lang";
import { useLang } from "../../_i18n/provider";
import { Card, IconDisc, Input, Panel, Spinner, buttonClass } from "../../_ui/kit";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { GateHead, PhoneNotice, PhoneProblem, PhoneSkeleton, bigButton } from "../../_ui/phone";
import { serverClock } from "../../_ui/phone.text";
import { clock } from "../../_ui/plain";
import { Target } from "../../_ui/target";
import { changeBefore, changeLines, signedRows } from "../../k/[kitchen]/rules-change";
import { RULES_CHANGE_TEXT } from "./rules-change-screen.text";
import { APPROVAL_TEXT } from "./approval-screen.text";
import { isRole, signerL } from "../../_i18n/signer";

const OPTIONS_FRESH_MS = 4 * 60_000;
const POLL_MS = 4000;

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** "21.04" today, "Sun 21.04" on another day, in the reader's language and Helsinki time. */
function when(iso: string, lang: Lang): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Europe/Helsinki" });
  const t = serverClock(clock(iso), lang);
  if (day(d) === day(new Date())) return t;
  const wd = d.toLocaleDateString(lang === "fi" ? "fi-FI" : lang === "sv" ? "sv-FI" : "en-GB", { weekday: "short", timeZone: "Europe/Helsinki" });
  return `${wd} ${t}`;
}

/**
 * The approver's phone for a change to the kitchen's rules that widens what its agent may do: exactly what would
 * change, who asked and when, until when it can be signed, then the passkey. The same ceremony as an order's sign-off
 * (a prompt bound to this exact change and a fresh nonce), on its own routes (/ui-api/rules-changes/{id}).
 */
export function RulesChangeScreen({ approvalId }: { approvalId: string }) {
  const { lang } = useLang();
  const tx = RULES_CHANGE_TEXT[lang];
  const ax = APPROVAL_TEXT[lang];
  const [view, setView] = useState<RulesChangeView | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [phase, setPhase] = useState<"idle" | "passkey" | "sending">("idle");
  const [problem, setProblem] = useState<{ title: string; body: string; quiet?: boolean } | null>(null);
  const [supported, setSupported] = useState(true);
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const prepared = useRef<{ options: PublicKeyCredentialRequestOptionsJSON; at: number } | null>(null);
  const base = `/ui-api/rules-changes/${encodeURIComponent(approvalId)}`;

  const refresh = useCallback(async () => {
    const r = await api<{ view: RulesChangeView }>("GET", base);
    if (r.ok) {
      setView(r.data.view);
      setLoadError(null);
      return r.data.view;
    }
    setLoadError(r.error);
    return null;
  }, [base]);

  /** Prepared before the tap: Safari opens a passkey prompt only straight from a tap. */
  const prepare = useCallback(async () => {
    const r = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("POST", `${base}/challenge`, { decision: "approve" });
    prepared.current = r.ok ? { options: r.data.options, at: Date.now() } : null;
    return prepared.current;
  }, [base]);

  useEffect(() => {
    queueMicrotask(() => {
      setSupported(browserSupportsWebAuthn() && window.isSecureContext);
      void refresh().then((v) => {
        if (v?.state === "pending" && v.signIn === "passkey") void prepare();
      });
    });
    // Decided elsewhere (the kitchen's browser, another phone): the screen follows.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh, prepare]);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setPhase("sending");
    const r = await api<{ view: RulesChangeView }>("POST", base, body);
    setPhase("idle");
    if (r.ok) {
      setView(r.data.view);
      setProblem(null);
      return true;
    }
    setProblem({ title: tx.failed, body: r.error.message });
    void refresh();
    return false;
  }

  async function approve() {
    setProblem(null);
    setPhase("passkey");
    let p = prepared.current;
    if (!p || Date.now() - p.at > OPTIONS_FRESH_MS) p = await prepare();
    if (!p) {
      setPhase("idle");
      return setProblem({ title: tx.failed, body: tx.noPasskey });
    }
    let response;
    try {
      response = await startAuthentication({ optionsJSON: p.options });
    } catch (err) {
      setPhase("idle");
      const q = passkeyProblemL(err, lang);
      return setProblem({ title: q.title, body: q.body, quiet: q.cancelled });
    }
    prepared.current = null;
    if (!(await send({ decision: "approve", proof: { kind: "webauthn", response } }))) void prepare();
  }

  async function decline() {
    setProblem(null);
    const note = reason.trim() || undefined;
    if (view?.viewerIsApprover) return void send({ decision: "decline", note, proof: { kind: "session" } });
    setPhase("passkey");
    const r = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("POST", `${base}/challenge`, { decision: "decline" });
    if (!r.ok) {
      setPhase("idle");
      return setProblem({ title: tx.failed, body: r.error.message });
    }
    try {
      const response = await startAuthentication({ optionsJSON: r.data.options });
      await send({ decision: "decline", note, proof: { kind: "webauthn", response } });
    } catch (err) {
      setPhase("idle");
      const q = passkeyProblemL(err, lang);
      setProblem({ title: q.title, body: q.body, quiet: q.cancelled });
    }
  }

  if (loadError && !view)
    return (
      <PhoneNotice
        title={loadError.code === "approval_on_signer_phone" ? ax.scanAgain : loadError.code === "approval_not_found" ? ax.onApproverPhone : tx.failed}
        body={loadError.code === "approval_on_signer_phone" ? ax.scanAgainBody.replace(/the order|tilauksen|beställningen/, (m) => ({ "the order": "the change", tilauksen: "muutoksen", beställningen: "ändringen" })[m] ?? m) : loadError.code === "approval_not_found" ? ax.onApproverPhoneBody : loadError.message}
        mark={
          <IconDisc tone="muted" size={56}>
            <CircleSlash size={26} />
          </IconDisc>
        }
      >
        <button className={`mt-auto ${bigButton("dark")}`} onClick={() => void refresh()}>
          {tx.tryAgain}
        </button>
      </PhoneNotice>
    );
  if (!view) return <PhoneSkeleton label={tx.opening} gate />;
  if (view.state !== "pending") return <Decided view={view} />;

  const busy = phase !== "idle";
  const lines = changeLines(view.changes, lang);
  const rows = signedRows(view.changes);
  return (
    <div className="flex flex-1 flex-col">
      <GateHead title={tx.title} sub={tx.sub(view.kitchenName, isRole(view.approverName) ? "" : view.approverName)}>
        <ul className="mt-5 space-y-2.5" aria-label={tx.whatChanges}>
          {lines.map((l, i) => (
            <li key={l} className="display text-[1.45rem] leading-snug text-paper [overflow-wrap:break-word]">
              {l}
              {rows[i] && changeBefore(rows[i], lang) && <span className="mt-0.5 block font-sans text-[0.9rem] font-normal text-paper/65">{changeBefore(rows[i], lang)}</span>}
            </li>
          ))}
        </ul>
      </GateHead>

      <Panel className="mt-5 space-y-3 px-4 py-3.5">
        <p className="flex items-start gap-2.5 text-[0.95rem] leading-snug">
          <UserRound aria-hidden size={18} className="mt-[0.1em] shrink-0 text-petrol" />
          <span>{tx.asked(view.requestedBy, when(view.requestedAt, lang))}</span>
        </p>
        {view.thenWhat && (
          <p className="flex items-start gap-2.5 text-[0.95rem] leading-snug">
            <Target size={18} tone="safety" className="mt-[0.1em] shrink-0" />
            <span>{tx.thenWhat(view.thenWhat)}</span>
          </p>
        )}
        {view.expiresAt && (
          <p className="flex items-start gap-2.5 text-[0.95rem] leading-snug">
            <Clock aria-hidden size={18} className="mt-[0.1em] shrink-0 text-petrol" />
            <span>{tx.until(when(view.expiresAt, lang))}</span>
          </p>
        )}
      </Panel>

      <details className="group mt-4 rounded-xl border border-line bg-paper">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2 font-medium text-petrol [&::-webkit-details-marker]:hidden">
          {tx.details}
          <ChevronDown aria-hidden size={18} className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="space-y-2 border-t border-line px-4 py-3.5 text-[0.86rem] leading-snug text-ink-soft">
          <p className="break-all">{tx.ids(view.details)}</p>
          <p className="break-all">{tx.digest(view.details.digest)}</p>
        </div>
      </details>

      {problem && <PhoneProblem title={problem.title} body={problem.body} quiet={problem.quiet} />}

      <div className="sticky bottom-0 z-10 -mx-4 mt-auto pt-6">
        <div className="rounded-t-2xl border-t border-line bg-paper/95 px-4 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-4 shadow-[0_-12px_30px_-18px_rgb(0_54_70/0.35)] backdrop-blur-md">
          {view.signIn === "passkey" ? (
            <button className={bigButton("go")} disabled={busy || !supported} onClick={() => void approve()}>
              {phase === "idle" ? <ScanFace aria-hidden size={22} strokeWidth={2.1} /> : <Spinner size={18} />}
              {phase === "passkey" ? tx.waitingBio : phase === "sending" ? tx.saving : tx.approve}
            </button>
          ) : (
            <p className="text-[0.95rem] font-semibold leading-snug">{tx.noPasskey}</p>
          )}
          {view.signIn === "passkey" && !supported && <p className="mt-2 text-[0.92rem] font-semibold leading-snug">{tx.noPasskeyBrowser}</p>}
          {showReason && <Input className="mt-3" placeholder={tx.reasonLabel} maxLength={300} value={reason} onChange={setReason} aria-label={tx.reasonLabel} />}
          {view.signIn === "passkey" && (
            <div className="mt-2.5 flex items-center gap-2">
              <button className={`${buttonClass("secondary", "md", "min-h-12 min-w-0 flex-1")} disabled:opacity-50`} disabled={busy} onClick={() => void decline()}>
                {tx.decline}
              </button>
              {!showReason && (
                <button type="button" className={buttonClass("quiet", "md", "shrink-0 px-3")} onClick={() => setShowReason(true)}>
                  {tx.addReason}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Decided({ view }: { view: RulesChangeView }) {
  const { lang } = useLang();
  const tx = RULES_CHANGE_TEXT[lang];
  const o = view.outcome;
  const signed = view.state === "signed";
  const declined = view.state === "declined";
  const title = signed ? tx.signed : declined ? tx.declined : view.state === "expired" ? tx.expired : tx.closed;
  const body = signed && o ? tx.signedBody(cap(signerL(o.by, lang)), when(o.at, lang)) : declined && o ? tx.declinedBody(cap(signerL(o.by, lang)), when(o.at, lang)) : view.state === "expired" ? tx.expiredBody : tx.closedBody;
  return (
    <div className="flex flex-1 flex-col" role="status" aria-live="polite">
      <IconDisc tone={signed ? "good" : "muted"} size={60}>
        {signed ? <ShieldCheck size={28} /> : declined ? <CircleX size={28} /> : <Hourglass size={26} />}
      </IconDisc>
      <h1 className="display mt-5 text-[2.1rem] leading-[1.05] text-ink [overflow-wrap:break-word]">{title}</h1>
      <Card className="mt-5">
        <ul className="divide-y divide-line">
          {changeLines(view.changes, lang).map((l) => (
            <li key={l} className={`px-4 py-3.5 leading-snug ${signed ? "" : "text-ink-soft line-through decoration-1"}`}>
              {l}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-3.5 leading-snug">{body}</p>
        {o?.note && <p className="border-t border-line px-4 py-3 text-ink-soft">“{o.note}”</p>}
      </Card>
      <Link href="/approver" className={`mt-auto ${bigButton("secondary")}`}>
        {tx.back}
      </Link>
    </div>
  );
}
