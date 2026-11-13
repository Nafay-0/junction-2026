"use client";

import { browserSupportsWebAuthn, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalView } from "@/server/approval-view";
import { api, passkeyProblem, type ApiError } from "../../_client/api";
import { useDockEvents } from "../../_client/use-dock-events";
import { fiMoney } from "../../_ui/plain";
import { GateHead, PhoneNotice, PhoneProblem, bigButton } from "../../_ui/phone";

type Phase = "idle" | "passkey" | "sending";
type Problem = { title: string; body: string; cancelled?: boolean };
type DecideReply = { view?: ApprovalView; order?: unknown };

const OPTIONS_FRESH_MS = 4 * 60_000; // the server's prompts live 5 minutes
const QUICK_REASONS = ["Too expensive", "Wrong product", "Not needed now"];

export function ApprovalScreen({ approvalId, token }: { approvalId: string; token?: string }) {
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
    const r = await api<{ view: ApprovalView }>("GET", `/api/v1/approvals/${encodeURIComponent(approvalId)}`);
    if (r.ok) {
      setView(r.data.view);
      setLoadError(null);
      return r.data.view;
    }
    setLoadError(r.error);
    return null;
  }, [approvalId]);

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

  useDockEvents(`/api/v1/events?approvalId=${encodeURIComponent(approvalId)}`, () => void refresh(), () => void refresh());

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setPhase("sending");
    const r = await api<DecideReply>("POST", `/api/v1/approvals/${encodeURIComponent(approvalId)}`, body);
    setPhase("idle");
    if (r.data?.view) setView(r.data.view);
    if (r.ok || r.error.code === "policy_rejected") {
      setProblem(null);
      return true;
    }
    setProblem({ title: r.status === 0 ? "No connection" : "Not accepted", body: r.error.message });
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
      setProblem({ title: "Can't start the passkey prompt", body: "Dock did not answer. Check the connection and try again." });
      return;
    }
    let response;
    try {
      response = await startAuthentication({ optionsJSON: p.options });
    } catch (err) {
      const pr = passkeyProblem(err);
      setPhase("idle");
      setProblem(pr);
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
      return setProblem({ title: "Can't decline here", body: r.error.message });
    }
    try {
      const response = await startAuthentication({ optionsJSON: r.data.options });
      await send({ decision: "decline", note, proof: { kind: "webauthn", response } });
    } catch (err) {
      setPhase("idle");
      setProblem(passkeyProblem(err));
    }
  }

  if (loadError && !view)
    return (
      <PhoneNotice title={loadError.code === "approval_not_found" ? "No such request" : "This request did not load"} body={loadError.message}>
        <button className={`mt-6 ${bigButton("dark")}`} onClick={() => void refresh()}>
          Try again
        </button>
      </PhoneNotice>
    );
  if (!view) return <p className="mt-20 text-center text-ink-soft">Opening the request…</p>;
  if (view.state !== "pending") return <Outcome view={view} />;

  const busy = phase !== "idle";
  const msLeft = Date.parse(view.priceHeldUntil) - now;
  const minutesLeft = Math.floor(msLeft / 60_000);
  const priceExpired = minutesLeft < 0;
  const passkeyUsable = view.signIn === "passkey" && supported;
  const showDemoTap = view.demoTapEnabled && view.viewerIsApprover && (view.signIn === "demo_tap" || passkeyFailed || !supported);
  const total = fiMoney(view.total);

  return (
    <div className="flex flex-1 flex-col">
      <GateHead title="Stopped at the gate" sub={`${view.agentName} needs your OK, ${view.approverName}.`}>
        <p className="display mt-5 text-[3.4rem] leading-none text-paper tabular">{total}</p>
        <p className="mt-1 text-[1.15rem] text-paper/90">
          Delivery <strong className="text-paper">{view.delivery}</strong>, {view.kitchenName}
        </p>
      </GateHead>

      <section className="mt-5">
        <h2 className="text-[0.95rem] font-semibold text-ink-soft">Why you are asked</h2>
        <ul className="mt-1.5 space-y-2">
          {view.why.map((w, i) => (
            <li key={i} className="border-l-[5px] border-safety-ink bg-safety/20 px-3 py-2 leading-snug">
              {fiMoney(w)}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-5">
        <h2 className="text-[0.95rem] font-semibold text-ink-soft">The order</h2>
        <ul className="mt-1.5 divide-y divide-line border-y border-line">
          {view.items.map((it, i) => (
            <li key={i} className="py-3">
              <p className="leading-snug">
                <strong className="display mr-1.5 text-[1.5rem]">{it.amount}</strong> {it.name}
              </p>
              {it.substituteFor && <p className="mt-1 text-[1rem] font-semibold">Swapped in for {it.substituteFor}</p>}
            </li>
          ))}
        </ul>
      </section>

      {view.differences.length > 0 && (
        <section className="mt-5 bg-lavender p-3">
          <h2 className="font-semibold text-lavender-deep">Not exactly what was asked</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {view.differences.map((d, i) => (
              <li key={i}>{fiMoney(d)}</li>
            ))}
          </ul>
          {view.asked && <p className="mt-2 text-[1rem] text-ink-soft">The request: &ldquo;{view.asked}&rdquo;</p>}
        </section>
      )}

      {view.licence && <p className="mt-4 text-[1rem] text-ink-soft">Agent: {view.licence}</p>}
      <div className="mt-4">
        <p className={`text-[1rem] ${priceExpired ? "font-semibold" : "text-ink-soft"}`}>
          {priceExpired
            ? "The fixed price has run out. Approving now will not place the order; the agent must get a new price."
            : `Price fixed until ${view.priceHeldUntilText} (${minutesLeft < 1 ? "under a minute" : `${minutesLeft} min`} left).`}
        </p>
        {!priceExpired && (
          <div aria-hidden className="mt-1.5 h-1.5 bg-line">
            <div className="h-full bg-petrol" style={{ width: `${Math.max(2, Math.min(100, (msLeft / (30 * 60_000)) * 100))}%` }} />
          </div>
        )}
      </div>

      <details className="mt-4 text-[1rem]">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-petrol underline decoration-2 underline-offset-4">Show details</summary>
        <div className="space-y-2 pb-2 text-[0.88rem] text-ink-soft">
          {view.items.map((it, i) => (
            <p key={i}>
              {it.packs} = {fiMoney(it.lineTotal)}, delivered {it.delivery}
            </p>
          ))}
          <p>
            Approver: {view.approverName} ({view.approverRoleLabel})
          </p>
          <p className="break-all">
            Approval {view.details.approvalId}, order {view.details.orderId}, quote {view.details.quoteId}, agent {view.details.agentId}, mandate {view.details.mandateId}
          </p>
          <p className="break-all">Your passkey signs this order fingerprint (SHA-256): {view.details.orderDigest}</p>
          <ul className="list-disc pl-5">
            {view.details.rules.map((r) => (
              <li key={r.rule}>
                {r.rule}: {r.outcome}. {fiMoney(r.reason)}
              </li>
            ))}
          </ul>
        </div>
      </details>

      {problem && <PhoneProblem title={problem.title} body={problem.body} quiet={problem.cancelled} />}

      <div className="sticky bottom-0 -mx-5 mt-auto border-t border-line bg-paper/95 px-5 pb-3 pt-4 backdrop-blur">
        {view.signIn === "passkey" && (
          <button className={bigButton("go")} disabled={busy || !passkeyUsable} onClick={() => void approveWithPasskey()}>
            {phase === "passkey" ? "Waiting for Face ID or fingerprint…" : phase === "sending" ? "Placing the order…" : `Approve ${total}`}
          </button>
        )}
        {view.signIn === "link_token" &&
          (token ? (
            <button className={bigButton("go")} disabled={busy} onClick={() => void send({ decision: "approve", token })}>
              Approve {total}
            </button>
          ) : (
            <p className="text-[1rem]">Open the approval link that was sent to {view.approverName} to decide.</p>
          ))}
        {view.signIn === "passkey" && !supported && <p className="mt-2 text-[1rem] font-semibold">This browser can&apos;t use passkeys. Try Safari on iPhone or Chrome on Android.</p>}
        {view.signIn === "demo_tap" && !view.demoTapEnabled && <p className="text-[1rem] font-semibold">You joined without a passkey and the demo fallback is now off, so you can only decline.</p>}
        {showDemoTap && (
          <button className={`mt-3 ${bigButton("demo")} min-h-14 text-[1rem]`} disabled={busy} onClick={() => void send({ decision: "approve", proof: { kind: "demo_tap" } })}>
            Demo only: approve without a passkey (not verified)
          </button>
        )}

        {showReason && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {QUICK_REASONS.map((q) => (
                <button key={q} type="button" aria-pressed={reason === q} className={`min-h-11 border-2 px-3 text-[1rem] ${reason === q ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`} onClick={() => setReason(reason === q ? "" : q)}>
                  {q}
                </button>
              ))}
            </div>
            <input
              className="mt-2 min-h-12 w-full border-2 border-line px-3 text-[1rem] focus:border-petrol"
              placeholder="Reason (optional)"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Reason for declining (optional)"
            />
          </div>
        )}
        {(view.signIn !== "link_token" || token) && (
          <div className="mt-3 flex items-center gap-3">
            <button className={`${bigButton("secondary")} min-h-14 flex-1 text-[1.08rem]`} disabled={busy} onClick={() => void decline()}>
              Decline{reason.trim() ? `: ${reason.trim().slice(0, 24)}` : ""}
            </button>
            {!showReason && (
              <button type="button" className="min-h-14 px-2 text-[1rem] font-semibold text-petrol underline decoration-2 underline-offset-4" onClick={() => setShowReason(true)}>
                Add reason
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Outcome({ view }: { view: ApprovalView }) {
  const o = view.outcome;
  const placed = view.state === "committed";
  const declined = view.state === "declined";
  const how =
    o?.method === "passkey"
      ? "with a passkey (Face ID, fingerprint or PIN on the approver's phone)"
      : o?.method === "demo_tap"
        ? "WITHOUT a passkey: demo-only tap, recorded as unverified"
        : o?.method === "approver_session"
          ? "from the approver's registered phone"
          : "with the one-time approval link";
  return (
    <div className="flex flex-1 flex-col" role="status" aria-live="polite">
      <div className={`stamp mt-6 self-start border-[5px] px-5 py-3 ${placed ? "border-petrol text-petrol" : declined ? "border-ink text-ink" : "border-safety-ink bg-safety text-safety-ink"}`}>
        <p className="display text-[2.6rem] leading-none">{placed ? "Signed off" : declined ? "Declined" : "Not placed"}</p>
        {o && <p className="mt-1 font-semibold">{o.signedBy}, {o.atText}</p>}
      </div>
      <h1 className="display mt-6 text-[2.4rem] text-ink">{placed ? "Order placed" : declined ? "Declined" : "Approved, but not placed"}</h1>
      <p className="mt-1 text-[1.2rem]">
        <span className="tabular">{fiMoney(view.total)}</span>, {view.delivery}
      </p>
      {o && (
        <p className="mt-4 leading-snug">
          {o.decision === "approved" ? "Approved" : "Declined"} by {o.signedBy} at {o.atText}, {how}.
        </p>
      )}
      {o?.note && <p className="mt-2">Reason: &ldquo;{o.note}&rdquo;</p>}
      {o?.notPlacedReason && <p className="mt-2 font-semibold">{fiMoney(o.notPlacedReason)}</p>}
      {o && !o.verified && <p className="mt-3 border-2 border-dashed border-ink-soft p-3 text-[1rem]">Demo only. This approval is not cryptographically verified and is marked so in the audit log.</p>}
      {placed && <p className="mt-3 text-[1rem] text-ink-soft">The wholesaler signed the order confirmation. It shows on the kitchen&apos;s screen and on the big screen.</p>}
      <Link href="/approver" className={`mt-auto ${bigButton("secondary")}`}>
        Back to my screen
      </Link>
    </div>
  );
}
