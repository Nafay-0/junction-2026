"use client";

import { browserSupportsWebAuthn, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalView } from "@/server/approval-view";
import { api, passkeyProblem, type ApiError } from "../../_client/api";
import { useDockEvents } from "../../_client/use-dock-events";

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
      <div className="mt-16">
        <h1 className="text-3xl font-bold">{loadError.code === "approval_not_found" ? "No such request" : "Can't load this request"}</h1>
        <p className="mt-3">{loadError.message}</p>
        <button className="mt-6 h-14 w-full rounded-xl bg-neutral-900 font-semibold text-white" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  if (!view) return <p className="mt-20 text-center text-neutral-600">Loading…</p>;
  if (view.state !== "pending") return <Outcome view={view} />;

  const busy = phase !== "idle";
  const minutesLeft = Math.floor((Date.parse(view.priceHeldUntil) - now) / 60_000);
  const priceExpired = minutesLeft < 0;
  const passkeyUsable = view.signIn === "passkey" && supported;
  const showDemoTap = view.demoTapEnabled && view.viewerIsApprover && (view.signIn === "demo_tap" || passkeyFailed || !supported);

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-base font-medium text-neutral-500">{view.kitchenName}</p>
      <h1 className="mt-1 text-2xl font-bold leading-snug">{view.agentName} needs your OK</h1>

      <p className="mt-4 text-5xl font-bold tabular-nums tracking-tight">{view.total}</p>
      <p className="mt-1 text-xl">
        Delivery <strong>{view.delivery}</strong>
      </p>

      <section className="mt-4 rounded-xl bg-blue-50 p-3">
        <h2 className="text-base font-semibold uppercase tracking-wide text-blue-900">Why you are asked</h2>
        <ul className="mt-1 space-y-1 text-blue-950">
          {view.why.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </section>

      <ul className="mt-4 divide-y divide-neutral-200 rounded-xl bg-neutral-100 px-3">
        {view.items.map((it, i) => (
          <li key={i} className="py-3">
            <p className="text-lg leading-snug">
              <strong className="text-xl">{it.amount}</strong> {it.name}
            </p>
            {it.substituteFor && <p className="mt-1 text-base font-semibold text-amber-800">Swapped in for {it.substituteFor}</p>}
          </li>
        ))}
      </ul>

      {view.differences.length > 0 && (
        <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <h2 className="text-base font-semibold uppercase tracking-wide text-amber-900">Not exactly what was asked</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-amber-950">
            {view.differences.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          {view.asked && <p className="mt-2 text-base text-amber-900">The request: &ldquo;{view.asked}&rdquo;</p>}
        </section>
      )}

      {view.licence && <p className="mt-3 text-base">Agent: {view.licence}</p>}
      <p className={`mt-3 text-base ${priceExpired ? "font-semibold text-red-800" : "text-neutral-600"}`}>
        {priceExpired
          ? "The fixed price has run out. Approving now will not place the order; the agent must get a new quote."
          : `Price fixed until ${view.priceHeldUntilText} (${minutesLeft < 1 ? "under a minute" : `${minutesLeft} min`} left).`}
      </p>

      <details className="mt-4 text-base">
        <summary className="cursor-pointer py-2 text-neutral-600">Show details</summary>
        <div className="space-y-2 pb-2 text-sm text-neutral-700">
          {view.items.map((it, i) => (
            <p key={i}>
              {it.packs} = {it.lineTotal}, delivered {it.delivery}
            </p>
          ))}
          <p>Approver: {view.approverName} ({view.approverRoleLabel})</p>
          <p className="break-all">
            Approval {view.details.approvalId} · order {view.details.orderId} · quote {view.details.quoteId} · agent {view.details.agentId} · mandate {view.details.mandateId}
          </p>
          <p className="break-all">Your passkey signs this order fingerprint (SHA-256): {view.details.orderDigest}</p>
          <ul className="list-disc pl-5">
            {view.details.rules.map((r) => (
              <li key={r.rule}>
                {r.rule}: {r.outcome}. {r.reason}
              </li>
            ))}
          </ul>
        </div>
      </details>

      {problem && (
        <div role="alert" className={`mt-4 rounded-xl border p-3 ${problem.cancelled ? "border-neutral-300 bg-neutral-50" : "border-red-300 bg-red-50"}`}>
          <p className={`font-semibold ${problem.cancelled ? "" : "text-red-900"}`}>{problem.title}</p>
          <p className={`text-base ${problem.cancelled ? "text-neutral-700" : "text-red-900"}`}>{problem.body}</p>
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 mt-auto bg-white/95 px-5 pb-2 pt-4 backdrop-blur">
        {view.signIn === "passkey" && (
          <button className="h-16 w-full rounded-2xl bg-green-700 text-xl font-semibold text-white disabled:opacity-50" disabled={busy || !passkeyUsable} onClick={() => void approveWithPasskey()}>
            {phase === "passkey" ? "Waiting for Face ID or fingerprint…" : phase === "sending" ? "Placing the order…" : `Approve ${view.total}`}
          </button>
        )}
        {view.signIn === "link_token" &&
          (token ? (
            <button className="h-16 w-full rounded-2xl bg-green-700 text-xl font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void send({ decision: "approve", token })}>
              Approve {view.total}
            </button>
          ) : (
            <p className="text-base text-neutral-700">Open the approval link that was sent to {view.approverName} to decide.</p>
          ))}
        {view.signIn === "passkey" && !supported && <p className="mt-2 text-base text-red-800">This browser can&apos;t use passkeys. Try Safari on iPhone or Chrome on Android.</p>}
        {view.signIn === "demo_tap" && !view.demoTapEnabled && <p className="text-base text-red-800">You joined without a passkey and the demo fallback is now off, so you can only decline.</p>}
        {showDemoTap && (
          <button
            className="mt-3 h-14 w-full rounded-2xl border-2 border-dashed border-amber-500 text-base font-semibold text-amber-900 disabled:opacity-50"
            disabled={busy}
            onClick={() => void send({ decision: "approve", proof: { kind: "demo_tap" } })}
          >
            Demo only: approve without a passkey (not verified)
          </button>
        )}

        {showReason && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {QUICK_REASONS.map((q) => (
                <button key={q} type="button" className={`rounded-full border px-3 py-1 text-base ${reason === q ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`} onClick={() => setReason(reason === q ? "" : q)}>
                  {q}
                </button>
              ))}
            </div>
            <input
              className="mt-2 h-12 w-full rounded-xl border border-neutral-300 px-3 text-base"
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
            <button className="h-14 flex-1 rounded-2xl border-2 border-neutral-800 text-lg font-semibold disabled:opacity-50" disabled={busy} onClick={() => void decline()}>
              Decline{reason.trim() ? `: ${reason.trim().slice(0, 24)}` : ""}
            </button>
            {!showReason && (
              <button type="button" className="h-14 px-2 text-base text-neutral-600 underline" onClick={() => setShowReason(true)}>
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
  if (view.state === "withdrawn" || view.state === "expired") {
    return (
      <div className="mt-8 flex flex-1 flex-col" role="status" aria-live="polite">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-700 text-4xl text-white" aria-hidden>
          ×
        </div>
        <h1 className="mt-5 text-3xl font-bold">{view.state === "withdrawn" ? "Withdrawn by the kitchen" : "Expired unsigned"}</h1>
        <p className="mt-2 text-xl">
          {view.total} · {view.delivery}
        </p>
        {view.closedReason && <p className="mt-4">{view.closedReason}</p>}
        <Link href="/approver" className="mt-auto flex h-14 items-center justify-center rounded-xl border border-neutral-300 text-lg">
          Back to my screen
        </Link>
      </div>
    );
  }
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
    <div className="mt-8 flex flex-1 flex-col" role="status" aria-live="polite">
      <div className={`flex h-20 w-20 items-center justify-center rounded-full text-4xl text-white ${placed ? "bg-green-700" : declined ? "bg-neutral-700" : "bg-red-700"}`} aria-hidden>
        {placed ? "✓" : declined ? "×" : "!"}
      </div>
      <h1 className="mt-5 text-3xl font-bold">{placed ? "Order placed" : declined ? "Declined" : "Approved, but not placed"}</h1>
      <p className="mt-2 text-xl">
        {view.total} · {view.delivery}
      </p>
      {o && (
        <p className="mt-4">
          {o.decision === "approved" ? "Approved" : "Declined"} by {o.signedBy} at {o.atText}, {how}.
        </p>
      )}
      {o?.note && <p className="mt-2">Reason: &ldquo;{o.note}&rdquo;</p>}
      {o?.notPlacedReason && <p className="mt-2 font-semibold text-red-800">{o.notPlacedReason}</p>}
      {o && !o.verified && <p className="mt-3 rounded-xl border-2 border-dashed border-amber-500 p-3 text-base text-amber-900">Demo only. This approval is not cryptographically verified and is marked so in the audit log.</p>}
      {placed && <p className="mt-3 text-base text-neutral-600">The wholesaler signed the order confirmation. It shows on the big screen.</p>}
      <Link href="/approver" className="mt-auto flex h-14 items-center justify-center rounded-xl border border-neutral-300 text-lg">
        Back to my screen
      </Link>
    </div>
  );
}
