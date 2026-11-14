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
import { ArrowLeftRight, BadgeCheck, ChevronDown, CircleSlash, CircleX, Clock, Hourglass, ScanFace, ShieldCheck, Sparkles, TriangleAlert, Truck, Undo2 } from "lucide-react";
import { Card, Chip, IconDisc, Input, Panel, Spinner, buttonClass } from "../../_ui/kit";
import { GateHead, PhoneNotice, PhoneProblem, PhoneSkeleton, bigButton } from "../../_ui/phone";
import { Target } from "../../_ui/target";
import { serverClock, serverRole } from "../../_ui/phone.text";
import { APPROVAL_TEXT } from "./approval-screen.text";
import { clockOffset, priceMsLeft } from "./price-clock";
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
  /** The server's clock minus this phone's, from the latest view. */
  const clock = useRef(0);
  const prepared = useRef<{ options: PublicKeyCredentialRequestOptionsJSON; at: number } | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<{ view: ApprovalView }>("GET", `/api/v1/approvals/${encodeURIComponent(approvalId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`);
    if (r.ok) {
      clock.current = clockOffset(r.data.view.serverNow, Date.now());
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
    if (r.data?.view) {
      clock.current = clockOffset(r.data.view.serverNow, Date.now());
      setView(r.data.view);
    }
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
      <PhoneNotice
        title={loadError.code === "approval_not_found" ? tx.noSuch : tx.didNotLoad}
        body={loadError.message}
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
  if (view.state !== "pending") return <Outcome view={view} />;

  const busy = phase !== "idle";
  // By the server's clock, not the phone's: a phone set half an hour fast could not sign (price-clock.ts).
  const msLeft = priceMsLeft(view.priceHeldUntil, now, clock.current);
  const minutesLeft = Math.floor(msLeft / 60_000);
  const priceExpired = minutesLeft < 0;
  const share = Math.max(0, Math.min(1, msLeft / (30 * 60_000)));
  const passkeyUsable = view.signIn === "passkey" && supported;
  const showDemoTap = view.demoTapEnabled && view.viewerIsApprover && (view.signIn === "demo_tap" || passkeyFailed || !supported);
  const total = fiMoney(view.total);
  const why = whyLines(view, lang, f.ruleTitle);

  return (
    <div className="flex flex-1 flex-col">
      <GateHead title={tx.gateTitle} sub={tx.needsOk(serverAgentName(view.agentName, lang), view.approverName)}>
        <p className="display mt-6 text-[3.2rem] leading-none text-paper tabular">{total}</p>
        <p className="mt-3 flex items-start gap-2 text-[1rem] leading-snug text-paper/85">
          <Truck aria-hidden size={18} className="mt-[0.15em] shrink-0 text-paper/60" />
          <span>{tx.deliveryLine(<strong className="font-semibold text-paper">{serverDays(view.delivery, lang)}</strong>, view.kitchenName)}</span>
        </p>
      </GateHead>

      {view.recall?.map((r) => (
        <section key={r.productId} role="alert" className="mt-4 rounded-xl bg-safety-soft p-4 ring-1 ring-inset ring-safety">
          <h2 className="flex items-start gap-2.5 text-[1.05rem] font-semibold leading-snug">
            <TriangleAlert aria-hidden size={20} className="mt-0.5 shrink-0" />
            {tx.recallTitle(r.productName, !!r.drill)}
          </h2>
          <p className="mt-2 leading-snug">{r.reason}</p>
          <p className="mt-2 font-semibold leading-snug">{tx.recallBody}</p>
          <a href={r.noticeUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center font-semibold text-petrol underline decoration-petrol/40 underline-offset-4">
            {tx.recallNotice(r.publisher)}
          </a>
        </section>
      ))}

      <section aria-labelledby="why" className="mt-7">
        <h2 id="why" className="text-[0.92rem] font-medium text-ink-soft">
          {tx.whyAsked}
        </h2>
        <ul className="mt-2 space-y-2">
          {why.map((w, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg bg-safety-soft px-4 py-3 ring-1 ring-inset ring-safety/50">
              <Target size={20} tone="safety" className="mt-0.5 shrink-0" />
              <span className="min-w-0 leading-snug">
                <span className="font-medium">{w.main}</span>
                {w.detail && <span className="mt-0.5 block text-[0.9rem] text-ink-soft">{w.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="order" className="mt-7">
        <h2 id="order" className="text-[0.92rem] font-medium text-ink-soft">
          {tx.theOrder}
        </h2>
        <Card className="mt-2">
          <ul className="divide-y divide-line">
            {view.items.map((it, i) => (
              <li key={i} className="px-4 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="display text-[1.55rem] leading-none text-petrol-deep tabular">{serverAmount(it.amount, lang)}</p>
                  <p className="shrink-0 font-semibold tabular">{fiMoney(it.lineTotal)}</p>
                </div>
                <p className="mt-2 leading-snug">{it.name}</p>
                <p className="mt-1 text-[0.88rem] leading-snug text-ink-soft">{serverPacks(it.packs, lang)}</p>
                {it.substituteFor && (
                  <p className="mt-2.5 flex items-start gap-2 rounded-md bg-lavender px-3 py-2 text-[0.92rem] leading-snug text-lavender-deep">
                    <ArrowLeftRight aria-hidden size={16} className="mt-[0.15em] shrink-0" />
                    <span className="font-medium">{tx.swappedFor(it.substituteFor)}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-3 border-t border-line bg-mist/70 px-4 py-3.5">
            <span className="font-medium">{tx.total}</span>
            <span className="display text-[1.5rem] tabular">{total}</span>
          </div>
        </Card>
      </section>

      {view.differences.length > 0 && (
        <Panel tone="agent" className="mt-4 p-4">
          <h2 className="flex items-center gap-2 font-semibold text-lavender-deep">
            <Sparkles aria-hidden size={16} />
            {tx.notExactly}
          </h2>
          <ul className="mt-2 space-y-1.5">
            {view.differences.map((d, i) => (
              <li key={i} className="flex gap-2 leading-snug">
                <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-lavender-deep" />
                <span>{serverDifference(d, lang)}</span>
              </li>
            ))}
          </ul>
          {view.asked && <p className="mt-3 border-t border-lavender-mid pt-3 text-[0.95rem] leading-snug text-ink-soft">{tx.theRequest(view.asked)}</p>}
        </Panel>
      )}

      <Panel className="mt-4 px-4 py-3.5">
        <p className={`flex items-start gap-2.5 text-[0.95rem] leading-snug ${priceExpired ? "font-semibold" : ""}`}>
          <Clock aria-hidden size={18} className={`mt-[0.1em] shrink-0 ${priceExpired || share < 0.2 ? "text-notice" : "text-petrol"}`} />
          <span>{priceExpired ? tx.priceExpired : tx.priceUntil(serverClock(view.priceHeldUntilText, lang), minutesLeft)}</span>
        </p>
        {!priceExpired && (
          <div aria-hidden className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-paper">
            <div className={`h-full rounded-full transition-[width] duration-500 ${share < 0.2 ? "bg-notice" : "bg-petrol"}`} style={{ width: `${Math.max(2, share * 100)}%` }} />
          </div>
        )}
        {view.licence && (
          <p className="mt-3 flex items-start gap-2.5 border-t border-line pt-3 text-[0.9rem] leading-snug text-ink-soft">
            <BadgeCheck aria-hidden size={17} className="mt-[0.1em] shrink-0" />
            <span>{tx.agentLicence(serverLicence(view.licence, lang))}</span>
          </p>
        )}
      </Panel>

      <details className="group mt-4 rounded-xl border border-line bg-paper">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2 font-medium text-petrol [&::-webkit-details-marker]:hidden">
          {tx.showDetails}
          <ChevronDown aria-hidden size={18} className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="space-y-2.5 border-t border-line px-4 py-3.5 text-[0.86rem] leading-snug text-ink-soft">
          {view.items.map((it, i) => (
            <p key={i}>{tx.packsLine(serverPacks(it.packs, lang), fiMoney(it.lineTotal), serverDays(it.delivery, lang))}</p>
          ))}
          <p>{tx.approverLine(view.approverName, serverRole(view.approverRoleLabel, lang))}</p>
          <p className="break-all">{tx.ids(view.details)}</p>
          <p className="break-all">{tx.digest(view.details.orderDigest)}</p>
          <ul className="space-y-1.5">
            {view.details.rules.map((r) => (
              <li key={r.rule} className="flex gap-2">
                <span aria-hidden className={`mt-[0.45em] size-1.5 shrink-0 rounded-full ${r.outcome === "pass" ? "bg-good" : r.outcome === "escalate" ? "bg-safety ring-1 ring-safety-ink/40" : "bg-bad"}`} />
                <span className="min-w-0 break-words">{tx.ruleLine(r.rule, f.ruleTitle(r.rule), tx.outcomeWord[r.outcome] ?? r.outcome, fiMoney(r.reason))}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      {shown && <PhoneProblem title={shown.title} body={shown.body} quiet={shown.cancelled} />}

      {/* The decision, under the thumb: it stays at the bottom edge while the order above is read. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-auto pt-6">
        <div className="rounded-t-2xl border-t border-line bg-paper/95 px-4 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-4 shadow-[0_-12px_30px_-18px_rgb(0_54_70/0.35)] backdrop-blur-md">
          {view.signIn === "passkey" && (
            <button className={bigButton("go")} disabled={busy || !passkeyUsable} onClick={() => void approveWithPasskey()}>
              {phase === "idle" ? <ScanFace aria-hidden size={22} strokeWidth={2.1} /> : <Spinner size={18} />}
              {phase === "passkey" ? tx.waitingBio : phase === "sending" ? tx.placing : tx.approve(total)}
            </button>
          )}
          {view.signIn === "link_token" &&
            (token ? (
              <button className={bigButton("go")} disabled={busy} onClick={() => void send({ decision: "approve", token })}>
                {tx.approve(total)}
              </button>
            ) : (
              <p className="text-[0.95rem] leading-snug">{tx.openLink(view.approverName)}</p>
            ))}
          {view.signIn === "passkey" && !supported && <p className="mt-2 text-[0.92rem] font-semibold leading-snug">{tx.noPasskeyBrowser}</p>}
          {view.signIn === "demo_tap" && !view.demoTapEnabled && <p className="text-[0.92rem] font-semibold leading-snug">{tx.demoOff}</p>}
          {showDemoTap && (
            <button className={`mt-2.5 ${bigButton("demo")}`} disabled={busy} onClick={() => void send({ decision: "approve", proof: { kind: "demo_tap" } })}>
              {tx.demoApprove}
            </button>
          )}

          {showReason && (
            <div className="sheet-up mt-3.5">
              <div className="flex flex-wrap gap-2">
                {tx.quickReasons.map((q) => (
                  <Chip key={q} on={reason === q} onClick={() => setReason(reason === q ? "" : q)}>
                    {q}
                  </Chip>
                ))}
              </div>
              <Input className="mt-2.5" placeholder={tx.reasonPlaceholder} maxLength={500} value={reason} onChange={setReason} aria-label={tx.reasonLabel} />
            </div>
          )}
          {(view.signIn !== "link_token" || token) && (
            <div className="mt-2.5 flex items-center gap-2">
              <button className={`${buttonClass("secondary", "md", "min-h-12 min-w-0 flex-1")} disabled:opacity-50`} disabled={busy} onClick={() => void decline()}>
                <span className="truncate">{tx.decline(reason.trim().slice(0, 24))}</span>
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
      <div className="mt-4 flex flex-1 flex-col" role="status" aria-live="polite">
        <IconDisc tone="muted" size={60}>
          {view.state === "withdrawn" ? <Undo2 size={26} /> : <Hourglass size={26} />}
        </IconDisc>
        <h1 className="display mt-5 text-[2.1rem] leading-[1.05] text-ink hyphens-manual [overflow-wrap:break-word]">{view.state === "withdrawn" ? tx.withdrawn : tx.expired}</h1>
        <Card className="mt-5">
          <div className="flex items-baseline justify-between gap-3 px-4 py-3.5">
            <span className="text-ink-soft">{serverDays(view.delivery, lang)}</span>
            <span className="display text-[1.35rem] text-ink-soft line-through decoration-1 tabular">{fiMoney(view.total)}</span>
          </div>
          {reason && <p className="border-t border-line px-4 py-3.5 leading-snug text-ink-soft">{reason}</p>}
        </Card>
        <Link href="/approver" className={`mt-auto ${bigButton("secondary")}`}>
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
  const stampLook = placed ? "border-good/40 bg-good-soft text-good" : declined ? "border-line-strong bg-paper text-ink" : "border-safety-ink bg-safety-ink text-safety";
  return (
    <div className="flex flex-1 flex-col" role="status" aria-live="polite">
      <div className={`stamp mt-2 inline-flex items-center gap-3.5 self-start rounded-xl border-2 py-3 pl-3.5 pr-5 ${stampLook}`}>
        {placed ? <ShieldCheck aria-hidden size={34} strokeWidth={1.9} /> : declined ? <CircleX aria-hidden size={34} strokeWidth={1.9} /> : <Target size={34} tone="safety" />}
        <span className="min-w-0">
          {/* The stamp's word, unless the heading under it already says the same ("Declined" twice reads as a stutter). */}
          {(placed ? tx.stampSigned : declined ? tx.stampDeclined : tx.stampNotPlaced) !== (placed ? tx.placed : declined ? tx.declined : tx.approvedNotPlaced) && (
            <span className="display block text-[1.9rem] leading-none">{placed ? tx.stampSigned : declined ? tx.stampDeclined : tx.stampNotPlaced}</span>
          )}
          {o && (
            <span className="mt-1 block text-[0.92rem] font-semibold first:mt-0 first:text-[1.05rem]">
              {o.signedBy}, {at(o.atText)}
            </span>
          )}
        </span>
      </div>
      <h1 className="display mt-7 text-[2.1rem] leading-[1.05] text-ink hyphens-manual [overflow-wrap:break-word]">{placed ? tx.placed : declined ? tx.declined : tx.approvedNotPlaced}</h1>
      <Card className="mt-5">
        <div className="flex items-baseline justify-between gap-3 px-4 py-3.5">
          <span>{serverDays(view.delivery, lang)}</span>
          <span className="display text-[1.5rem] tabular">{fiMoney(view.total)}</span>
        </div>
        <div className="space-y-2.5 border-t border-line px-4 py-3.5 leading-snug">
          {o && <p>{tx.decidedLine(o.decision === "approved", o.signedBy, at(o.atText), how)}</p>}
          {o?.note && <p className="text-ink-soft">{tx.reasonQuote(o.note)}</p>}
          {notPlaced && <p className="font-semibold">{notPlaced}</p>}
        </div>
      </Card>
      {o && !o.verified && <p className="mt-3 rounded-lg border border-dashed border-line-strong bg-paper px-4 py-3 text-[0.92rem] leading-snug">{tx.notVerified}</p>}
      {placed && <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">{tx.placedNote}</p>}
      <Link href="/approver" className={`mt-auto ${bigButton("secondary")}`}>
        {tx.back}
      </Link>
    </div>
  );
}
