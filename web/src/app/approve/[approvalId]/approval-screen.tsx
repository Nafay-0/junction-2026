"use client";

import { browserSupportsWebAuthn, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalViewWithRecall as ApprovalView } from "@/server/approval-api";
import { api, type ApiError } from "../../_client/api";
import { useDockEvents } from "../../_client/use-dock-events";
import type { Lang } from "../../_i18n/lang";
import { useFormat, useLang } from "../../_i18n/provider";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { fiMoney } from "../../_ui/plain";
import { GateHead, PhoneNotice, PhoneProblem, bigButton } from "../../_ui/phone";
import { serverClock, serverRole } from "../../_ui/phone.text";
import { APPROVAL_TEXT } from "./approval-screen.text";
import { serverAgentName, serverAmount, serverDays, serverDifference, serverLicence, serverPacks } from "./server-words";

type Phase = "idle" | "passkey" | "sending";
/** Kept as a kind, not as words, so the screen follows a language switch. Server messages stay as they came. */
type Problem = { key: "noConnection" | "notAccepted" | "cantStart" | "cantDecline"; body?: string } | { key: "passkey"; err: unknown };
type DecideReply = { view?: ApprovalView; order?: unknown };

const OPTIONS_FRESH_MS = 4 * 60_000; // the server's prompts live 5 minutes

/**
 * "Why you are asked", line by line. English shows the server's sentences as they are. Finnish and Swedish say the
 * escalated rules again from their ids (the server lists the money rule first, as here), with the server's sentence
 * kept as the detail where the rule has no fixed wording.
 */
function whyLines(view: ApprovalView, lang: Lang, ruleTitle: (r: string) => string): { main: string; detail?: string }[] {
  const tx = APPROVAL_TEXT[lang];
  const esc = view.details.rules.filter((r) => r.outcome === "escalate").sort((a, b) => Number(b.rule === "per_order_limit") - Number(a.rule === "per_order_limit"));
  return view.why.map((w, i) => {
    if (lang === "en" || esc.length !== view.why.length) return { main: fiMoney(w) };
    const rule = esc[i].rule;
    if (rule === "per_order_limit") {
      const limit = /€\s?[\d,]+(?:\.\d{1,2})?/.exec(w);
      if (limit) return { main: tx.whyLimit(fiMoney(limit[0])) };
    }
    if (rule === "substitution_rule") return { main: tx.whySwap };
    return { main: ruleTitle(rule), detail: fiMoney(w) };
  });
}

export function ApprovalScreen({ approvalId, token }: { approvalId: string; token?: string }) {
  const { lang } = useLang();
  const f = useFormat();
  const tx = APPROVAL_TEXT[lang];
  const [view, setView] = useState<ApprovalView | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [passkeyFailed, setPasskeyFailed] = useState(false);
  const [supported, setSupported] = useState(true);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const prepared = useRef<{ options: PublicKeyCredentialRequestOptionsJSON; at: number } | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<{ view: ApprovalView }>("GET", `/api/v1/approvals/${encodeURIComponent(approvalId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`);
    if (r.ok) {
      setView(r.data.view);
      setLoadError(null);
      return r.data.view;
    }
    setLoadError(r.error);
    return null;
  }, [approvalId, token]);

  /** Prepare the passkey prompt before the tap: Safari only opens it straight from a tap, with no fetch in between. */
  const prepare = useCallback(async () => {
    const r = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("POST", `/api/v1/approvals/${encodeURIComponent(approvalId)}/challenge`, { decision: "approve" });
    prepared.current = r.ok ? { options: r.data.options, at: Date.now() } : null;
    return prepared.current;
  }, [approvalId]);

  useEffect(() => {
    queueMicrotask(() => {
      setSupported(browserSupportsWebAuthn() && window.isSecureContext);
      void refresh().then((v) => {
        if (v?.state === "pending" && v.signIn === "passkey") void prepare();
      });
    });
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const renew = setInterval(() => {
      if (prepared.current && Date.now() - prepared.current.at > OPTIONS_FRESH_MS) void prepare();
    }, 30_000);
    return () => {
      clearInterval(tick);
      clearInterval(renew);
    };
  }, [refresh, prepare]);

  useDockEvents(`/api/v1/events?approvalId=${encodeURIComponent(approvalId)}${token ? `&token=${encodeURIComponent(token)}` : ""}`, () => void refresh(), () => void refresh());

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setPhase("sending");
    const r = await api<DecideReply>("POST", `/api/v1/approvals/${encodeURIComponent(approvalId)}`, body);
    setPhase("idle");
    if (r.data?.view) setView(r.data.view);
    if (r.ok || r.error.code === "policy_rejected") {
      setProblem(null);
      return true;
    }
    setProblem({ key: r.status === 0 ? "noConnection" : "notAccepted", body: r.error.message });
    void refresh();
    return false;
  }

  async function approveWithPasskey() {
    setProblem(null);
    setPhase("passkey");
    let p = prepared.current;
    if (!p || Date.now() - p.at > OPTIONS_FRESH_MS) p = await prepare();
    if (!p) {
      setPhase("idle");
      setProblem({ key: "cantStart" });
      return;
    }
    let response;
    try {
      response = await startAuthentication({ optionsJSON: p.options });
    } catch (err) {
      const pr = passkeyProblemL(err, "en");
      setPhase("idle");
      setProblem({ key: "passkey", err });
      if (!pr.cancelled) setPasskeyFailed(true);
      return; // the prompt was not used, so it stays valid for another try
    }
    prepared.current = null; // used: the server consumes it
    const ok = await send({ decision: "approve", proof: { kind: "webauthn", response } });
    if (!ok) {
      setPasskeyFailed(true);
      void prepare();
    }
  }

  async function decline() {
    setProblem(null);
    const note = reason.trim() || undefined;
    if (!view) return;
    if (view.signIn === "link_token") return void send({ decision: "decline", token, note });
    if (view.viewerIsApprover) return void send({ decision: "decline", note, proof: { kind: "session" } });
    // Not the phone that joined: decline with the passkey instead.
    setPhase("passkey");
    const r = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("POST", `/api/v1/approvals/${encodeURIComponent(approvalId)}/challenge`, { decision: "decline" });
    if (!r.ok) {
      setPhase("idle");
      return setProblem({ key: "cantDecline", body: r.error.message });
    }
    try {
      const response = await startAuthentication({ optionsJSON: r.data.options });
      await send({ decision: "decline", note, proof: { kind: "webauthn", response } });
    } catch (err) {
      setPhase("idle");
      setProblem({ key: "passkey", err });
    }
  }

  const shown: { title: string; body: string; cancelled?: boolean } | null = !problem
    ? null
    : problem.key === "passkey"
      ? passkeyProblemL(problem.err, lang)
      : { title: tx[problem.key], body: problem.body ?? tx.cantStartBody };

  if (loadError && !view)
    return (
      <PhoneNotice title={loadError.code === "approval_not_found" ? tx.noSuch : tx.didNotLoad} body={loadError.message}>
        <button className={`mt-6 ${bigButton("dark")}`} onClick={() => void refresh()}>
          {tx.tryAgain}
        </button>
      </PhoneNotice>
    );
  if (!view) return <p className="mt-20 text-center text-ink-soft">{tx.opening}</p>;
  if (view.state !== "pending") return <Outcome view={view} />;

  const busy = phase !== "idle";
  const msLeft = Date.parse(view.priceHeldUntil) - now;
  const minutesLeft = Math.floor(msLeft / 60_000);
  const priceExpired = minutesLeft < 0;
  const passkeyUsable = view.signIn === "passkey" && supported;
  const showDemoTap = view.demoTapEnabled && view.viewerIsApprover && (view.signIn === "demo_tap" || passkeyFailed || !supported);
  const total = fiMoney(view.total);
  const why = whyLines(view, lang, f.ruleTitle);

  return (
    <div className="flex flex-1 flex-col">
      <GateHead title={tx.gateTitle} sub={tx.needsOk(serverAgentName(view.agentName, lang), view.approverName)}>
        <p className="display mt-5 text-[3.4rem] leading-none text-paper tabular">{total}</p>
        <p className="mt-1 text-[1.15rem] text-paper/90">{tx.deliveryLine(<strong className="text-paper">{serverDays(view.delivery, lang)}</strong>, view.kitchenName)}</p>
      </GateHead>

      {view.recall?.map((r) => (
        <section key={r.productId} role="alert" className="mt-5 border-4 border-ink bg-safety p-4 text-safety-ink">
          <h2 className="font-display text-xl font-bold leading-tight">
            {tx.recallTitle(r.productName, !!r.drill)}
          </h2>
          <p className="mt-1.5">{r.reason}</p>
          <p className="mt-1.5 font-semibold">{tx.recallBody}</p>
          <a href={r.noticeUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-block font-semibold underline underline-offset-4">
            {tx.recallNotice(r.publisher)}
          </a>
        </section>
      ))}

      <section className="mt-5">
        <h2 className="text-[0.95rem] font-semibold text-ink-soft">{tx.whyAsked}</h2>
        <ul className="mt-1.5 space-y-2">
          {why.map((w, i) => (
            <li key={i} className="border-l-[5px] border-safety-ink bg-safety/20 px-3 py-2 leading-snug">
              {w.main}
              {w.detail && <span className="mt-0.5 block text-[0.92rem] text-ink-soft">{w.detail}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-5">
        <h2 className="text-[0.95rem] font-semibold text-ink-soft">{tx.theOrder}</h2>
        <ul className="mt-1.5 divide-y divide-line border-y border-line">
          {view.items.map((it, i) => (
            <li key={i} className="py-3">
              <p className="leading-snug">
                <strong className="display mr-1.5 text-[1.5rem]">{serverAmount(it.amount, lang)}</strong> {it.name}
              </p>
              {it.substituteFor && <p className="mt-1 text-[1rem] font-semibold">{tx.swappedFor(it.substituteFor)}</p>}
            </li>
          ))}
        </ul>
      </section>

      {view.differences.length > 0 && (
        <section className="mt-5 bg-lavender p-3">
          <h2 className="font-semibold text-lavender-deep">{tx.notExactly}</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {view.differences.map((d, i) => (
              <li key={i}>{serverDifference(d, lang)}</li>
            ))}
          </ul>
          {view.asked && <p className="mt-2 text-[1rem] text-ink-soft">{tx.theRequest(view.asked)}</p>}
        </section>
      )}

      {view.licence && <p className="mt-4 text-[1rem] text-ink-soft">{tx.agentLicence(serverLicence(view.licence, lang))}</p>}
      <div className="mt-4">
        <p className={`text-[1rem] ${priceExpired ? "font-semibold" : "text-ink-soft"}`}>
          {priceExpired ? tx.priceExpired : tx.priceUntil(serverClock(view.priceHeldUntilText, lang), minutesLeft)}
        </p>
        {!priceExpired && (
          <div aria-hidden className="mt-1.5 h-1.5 bg-line">
            <div className="h-full bg-petrol" style={{ width: `${Math.max(2, Math.min(100, (msLeft / (30 * 60_000)) * 100))}%` }} />
          </div>
        )}
      </div>

      <details className="mt-4 text-[1rem]">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-petrol underline decoration-2 underline-offset-4">{tx.showDetails}</summary>
        <div className="space-y-2 pb-2 text-[0.88rem] text-ink-soft">
          {view.items.map((it, i) => (
            <p key={i}>{tx.packsLine(serverPacks(it.packs, lang), fiMoney(it.lineTotal), serverDays(it.delivery, lang))}</p>
          ))}
          <p>{tx.approverLine(view.approverName, serverRole(view.approverRoleLabel, lang))}</p>
          <p className="break-all">{tx.ids(view.details)}</p>
          <p className="break-all">{tx.digest(view.details.orderDigest)}</p>
          <ul className="list-disc pl-5">
            {view.details.rules.map((r) => (
              <li key={r.rule}>{tx.ruleLine(r.rule, f.ruleTitle(r.rule), tx.outcomeWord[r.outcome] ?? r.outcome, fiMoney(r.reason))}</li>
            ))}
          </ul>
        </div>
      </details>

      {shown && <PhoneProblem title={shown.title} body={shown.body} quiet={shown.cancelled} />}

      <div className="sticky bottom-0 -mx-5 mt-auto border-t border-line bg-paper/95 px-5 pb-3 pt-4 backdrop-blur">
        {view.signIn === "passkey" && (
          <button className={bigButton("go")} disabled={busy || !passkeyUsable} onClick={() => void approveWithPasskey()}>
            {phase === "passkey" ? tx.waitingBio : phase === "sending" ? tx.placing : tx.approve(total)}
          </button>
        )}
        {view.signIn === "link_token" &&
          (token ? (
            <button className={bigButton("go")} disabled={busy} onClick={() => void send({ decision: "approve", token })}>
              {tx.approve(total)}
            </button>
          ) : (
            <p className="text-[1rem]">{tx.openLink(view.approverName)}</p>
          ))}
        {view.signIn === "passkey" && !supported && <p className="mt-2 text-[1rem] font-semibold">{tx.noPasskeyBrowser}</p>}
        {view.signIn === "demo_tap" && !view.demoTapEnabled && <p className="text-[1rem] font-semibold">{tx.demoOff}</p>}
        {showDemoTap && (
          <button className={`mt-3 ${bigButton("demo")} min-h-14 text-[1rem]`} disabled={busy} onClick={() => void send({ decision: "approve", proof: { kind: "demo_tap" } })}>
            {tx.demoApprove}
          </button>
        )}

        {showReason && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {tx.quickReasons.map((q) => (
                <button key={q} type="button" aria-pressed={reason === q} className={`min-h-11 border-2 px-3 text-[1rem] ${reason === q ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`} onClick={() => setReason(reason === q ? "" : q)}>
                  {q}
                </button>
              ))}
            </div>
            <input
              className="mt-2 min-h-12 w-full border-2 border-line px-3 text-[1rem] focus:border-petrol"
              placeholder={tx.reasonPlaceholder}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={tx.reasonLabel}
            />
          </div>
        )}
        {(view.signIn !== "link_token" || token) && (
          <div className="mt-3 flex items-center gap-3">
            <button className={`${bigButton("secondary")} min-h-14 flex-1 text-[1.08rem]`} disabled={busy} onClick={() => void decline()}>
              {tx.decline(reason.trim().slice(0, 24))}
            </button>
            {!showReason && (
              <button type="button" className="min-h-14 px-2 text-[1rem] font-semibold text-petrol underline decoration-2 underline-offset-4" onClick={() => setShowReason(true)}>
                {tx.addReason}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A server sentence for a closed request, said again from the state in Finnish or Swedish. */
function closedReason(view: ApprovalView, lang: Lang): string | undefined {
  if (lang === "en" || !view.closedReason) return view.closedReason;
  const tx = APPROVAL_TEXT[lang];
  if (view.state === "withdrawn") return tx.withdrawnReason(/: "([\s\S]*)"\. Nothing to sign\.$/.exec(view.closedReason)?.[1]);
  if (view.state === "expired") return tx.expiredReason(serverClock(view.priceHeldUntilText, lang));
  return view.closedReason;
}

/** Why an approved order was not placed: from the rule that failed, as the server chose it (approval-view.ts). */
function notPlacedReason(view: ApprovalView, lang: Lang): string | undefined {
  const reason = view.outcome?.notPlacedReason;
  if (lang === "en" || !reason) return reason && fiMoney(reason);
  const fail = view.details.rules.find((r) => r.outcome === "fail");
  return APPROVAL_TEXT[lang].notPlaced[fail ? fail.rule : "none"] ?? fiMoney(reason);
}

function Outcome({ view }: { view: ApprovalView }) {
  const { lang } = useLang();
  const tx = APPROVAL_TEXT[lang];
  const at = (t: string) => serverClock(t, lang);
  if (view.state === "withdrawn" || view.state === "expired") {
    const reason = closedReason(view, lang);
    return (
      <div className="mt-8 flex flex-1 flex-col" role="status" aria-live="polite">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-700 text-4xl text-white" aria-hidden>
          ×
        </div>
        <h1 className="mt-5 text-3xl font-bold">{view.state === "withdrawn" ? tx.withdrawn : tx.expired}</h1>
        <p className="mt-2 text-xl">
          {lang === "en" ? view.total : fiMoney(view.total)} · {serverDays(view.delivery, lang)}
        </p>
        {reason && <p className="mt-4">{reason}</p>}
        <Link href="/approver" className="mt-auto flex h-14 items-center justify-center rounded-xl border border-neutral-300 text-lg">
          {tx.back}
        </Link>
      </div>
    );
  }
  const o = view.outcome;
  const placed = view.state === "committed";
  const declined = view.state === "declined";
  const how = tx.how[o?.method ?? "link_token"] ?? tx.how.link_token;
  const notPlaced = notPlacedReason(view, lang);
  return (
    <div className="flex flex-1 flex-col" role="status" aria-live="polite">
      <div className={`stamp mt-6 self-start border-[5px] px-5 py-3 ${placed ? "border-petrol text-petrol" : declined ? "border-ink text-ink" : "border-safety-ink bg-safety text-safety-ink"}`}>
        <p className="display text-[2.6rem] leading-none">{placed ? tx.stampSigned : declined ? tx.stampDeclined : tx.stampNotPlaced}</p>
        {o && (
          <p className="mt-1 font-semibold">
            {o.signedBy}, {at(o.atText)}
          </p>
        )}
      </div>
      <h1 className="display mt-6 text-[2.4rem] text-ink hyphens-manual [overflow-wrap:break-word]">{placed ? tx.placed : declined ? tx.declined : tx.approvedNotPlaced}</h1>
      <p className="mt-1 text-[1.2rem]">
        <span className="tabular">{fiMoney(view.total)}</span>, {serverDays(view.delivery, lang)}
      </p>
      {o && <p className="mt-4 leading-snug">{tx.decidedLine(o.decision === "approved", o.signedBy, at(o.atText), how)}</p>}
      {o?.note && <p className="mt-2">{tx.reasonQuote(o.note)}</p>}
      {notPlaced && <p className="mt-2 font-semibold">{notPlaced}</p>}
      {o && !o.verified && <p className="mt-3 border-2 border-dashed border-ink-soft p-3 text-[1rem]">{tx.notVerified}</p>}
      {placed && <p className="mt-3 text-[1rem] text-ink-soft">{tx.placedNote}</p>}
      <Link href="/approver" className={`mt-auto ${bigButton("secondary")}`}>
        {tx.back}
      </Link>
    </div>
  );
}
