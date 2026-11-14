"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../_client/api";
import { useLang, useText } from "../../_i18n/provider";
import { buttonClass } from "../../_ui/kit";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { GateCard } from "../../_ui/thread";
import type { GateCard as GateCardT } from "@/server/thread/types";
import { usePortal } from "./portal";
import { THREAD_SIGNOFF_TEXT } from "./thread-signoff.text";

/**
 * The gate card of an order that waits for a person, with the next step on it. The sign-off itself is the existing
 * passkey flow, unchanged: a prompt bound to this approval and the order's current digest
 * (POST /api/v1/approvals/{id}/challenge), decided with that proof (POST /api/v1/approvals/{id}). What this adds:
 *
 *   - the truth about the signer's devices, instead of "asked on their phone" when there is no device;
 *   - "Sign with this device" for the kitchen's own signed-in account whose signer this order waits for (or the phone
 *     that is already the approver): when this browser holds no passkey of the signer yet, it is added first
 *     (POST /ui-api/account/device, the same step as Agent and rules), then the order is signed;
 *   - "Send to my phone": the sign-off screen's code (GET /ui-api/kitchens/{k}/approval/{id}) or, with no device yet,
 *     the one-time code that adds the phone as a signing device and then opens this order's sign-off.
 *
 * Nothing here approves anything: only the person's passkey does, checked by the server against the exact order.
 * When the sign-off lands, the thread's event stream turns this card into the signed outcome.
 */

type Qr = { mode: "passkey" | "no_device" | "enrol" | "demo_link"; url?: string; qrSvg?: string };
type Devices = { signer?: { name: string; role: string }; devices: unknown[] };
type View = { state: string; signIn: "passkey" | "demo_tap" | "link_token"; viewerIsApprover: boolean };
type Phase = "idle" | "registering" | "registered" | "signing" | "signed";

export function WaitingGate({ card, kind, title, reason, role, withdraw }: { card: GateCardT; kind: ReactNode; title: ReactNode; reason: ReactNode; role?: ReactNode; withdraw?: ReactNode }) {
  const tx = useText(THREAD_SIGNOFF_TEXT);
  const { lang } = useLang();
  const { kitchen, account } = usePortal();
  const approvalId = card.approvalId;
  const [qr, setQr] = useState<Qr>();
  const [devices, setDevices] = useState<Devices>();
  const [view, setView] = useState<View>();
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [phone, setPhone] = useState<{ url: string; qrSvg: string; adds: boolean }>();
  const [problem, setProblem] = useState<string>();
  const own = !!account && account.kitchen === kitchen.slug;

  const load = useCallback(async () => {
    if (!approvalId) return;
    const [q, v, d] = await Promise.all([
      api<Qr>("GET", `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/approval/${encodeURIComponent(approvalId)}`),
      api<{ view: View }>("GET", `/api/v1/approvals/${encodeURIComponent(approvalId)}`),
      own ? api<Devices>("GET", "/ui-api/account/device") : Promise.resolve(undefined),
    ]);
    if (q.ok) setQr(q.data);
    if (v.ok) setView(v.data.view);
    if (d?.ok) setDevices(d.data);
  }, [approvalId, kitchen.slug, own]);

  useEffect(() => {
    queueMicrotask(() => {
      setSupported(browserSupportsWebAuthn() && window.isSecureContext);
      void load();
    });
  }, [load]);

  // Who may sign here: the phone that is already this order's approver, or the kitchen's own account whose signer
  // this order waits for (it can add this device's passkey to that signer).
  const signerMatches = !!devices?.signer && devices.signer.role === card.approver?.role;
  const approverHere = !!view?.viewerIsApprover;
  // (Before the signer has any device the screen's own view says "link_token": adding this device's passkey is the way on.)
  const canSignHere = supported && view?.state === "pending" && ((approverHere && view.signIn === "passkey") || (own && signerMatches));
  const hasDevice = own && signerMatches ? (devices?.devices.length ?? 0) > 0 : qr?.mode === "passkey";
  const where = !qr && !view ? tx.checking : canSignHere ? (approverHere ? tx.hasDeviceHere : hasDevice ? tx.hasDevice : tx.noDeviceHere) : own && devices?.signer && !signerMatches && card.approver ? tx.otherSigner(card.approver.name) : hasDevice ? tx.onTheirPhone : qr?.mode === "no_device" ? tx.noDevice : tx.onTheirPhone;

  async function sign() {
    if (!approvalId) return;
    setProblem(undefined);
    try {
      if (!approverHere && phase !== "registered") {
        setPhase("registering");
        const begin = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>("POST", "/ui-api/account/device", { step: "begin" });
        if (!begin.ok) throw new Error(begin.error.message);
        const response = await startRegistration({ optionsJSON: begin.data.options });
        const done = await api<unknown>("POST", "/ui-api/account/device", { step: "verify", response });
        if (!done.ok) throw new Error(done.error.message);
        setPhase("registered");
      }
      setPhase("signing");
      const ch = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("POST", `/api/v1/approvals/${encodeURIComponent(approvalId)}/challenge`, { decision: "approve" });
      if (!ch.ok) throw new Error(ch.error.message);
      let response;
      try {
        response = await startAuthentication({ optionsJSON: ch.data.options });
      } catch (err) {
        // A browser that opens a passkey prompt only straight from a tap: the device is added, one more tap signs.
        setPhase(approverHere ? "idle" : "registered");
        const p = passkeyProblemL(err, lang);
        if (!p.cancelled) setProblem(`${p.title} ${p.body}`);
        void load();
        return;
      }
      const r = await api<{ view?: View }>("POST", `/api/v1/approvals/${encodeURIComponent(approvalId)}`, { decision: "approve", proof: { kind: "webauthn", response } });
      if (!r.ok && r.error.code !== "policy_rejected") throw new Error(r.error.message);
      setPhase("signed");
    } catch (err) {
      setPhase((s) => (s === "signing" || s === "registered" ? "registered" : "idle"));
      // A passkey prompt that failed speaks in the person's language; a refusal from the server is shown as it came.
      const fromPrompt = typeof (err as { name?: string }).name === "string" && (err as { name: string }).name !== "Error";
      if (!fromPrompt) setProblem((err as Error).message);
      else {
        const p = passkeyProblemL(err, lang);
        if (!p.cancelled) setProblem(`${p.title} ${p.body}`);
      }
      void load();
    }
  }

  async function toPhone() {
    if (phone) return setPhone(undefined);
    if (!approvalId) return;
    // No device yet, from the kitchen's own account: the code adds the phone as the signer's device, then opens this sign-off.
    if (own && signerMatches && !hasDevice) {
      const r = await api<{ url: string; qrSvg: string }>("POST", "/ui-api/account/device/link", { next: `/approve/${approvalId}` });
      if (r.ok) setPhone({ url: r.data.url, qrSvg: r.data.qrSvg, adds: true });
      else setProblem(r.error.message);
      return;
    }
    if (qr?.url && qr.qrSvg) setPhone({ url: qr.url, qrSvg: qr.qrSvg, adds: false });
  }

  const busy = phase === "registering" || phase === "signing";
  const offerPhone = (own && signerMatches) || (!!qr?.qrSvg && qr.mode !== "no_device");
  const actions = (
    <>
      {canSignHere && phase !== "signed" && (
        <button type="button" disabled={busy} className={buttonClass("safety", "sm")} onClick={() => void sign()}>
          {busy ? tx.signing : phase === "registered" ? tx.signNow : approverHere ? tx.signHere : tx.addAndSign}
        </button>
      )}
      {offerPhone && phase !== "signed" && (
        <button type="button" disabled={busy} className={buttonClass("ghost-dark", "sm")} aria-expanded={!!phone} onClick={() => void toPhone()}>
          {phone ? tx.hidePhone : tx.toPhone}
        </button>
      )}
      {phase !== "signed" && withdraw}
    </>
  );

  return (
    <div>
      <GateCard state="waiting" kind={kind} title={title} reason={reason} approver={card.approver ? { name: card.approver.name, role, where } : undefined} actions={actions} />
      {(phone || problem || phase === "signed") && (
        <div className="mt-2 rounded-lg bg-paper p-3 ring-1 ring-line" role="status">
          {phase === "signed" && <p className="font-semibold text-good">{tx.signed}</p>}
          {problem && (
            <p className="text-[0.92rem] text-bad">
              <b>{tx.failed}.</b> {problem}
            </p>
          )}
          {phone && (
            <div className="flex flex-wrap items-center gap-4">
              <span aria-hidden className="block size-40 shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: phone.qrSvg }} />
              <p className="min-w-0 flex-1 text-[0.92rem] leading-relaxed">
                {phone.adds ? tx.phoneAddHint : tx.phoneHint}{" "}
                <a className="font-semibold text-petrol underline underline-offset-4" href={phone.url}>
                  {tx.openOnPhone}
                </a>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
