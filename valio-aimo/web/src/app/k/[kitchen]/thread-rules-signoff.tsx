"use client";

import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Check, ScanFace, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../_client/api";
import { useLang, useText } from "../../_i18n/provider";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { clock } from "../../_ui/plain";
import type { RulesCard } from "@/server/thread/types";
import { usePortal } from "./portal";
import { signerL } from "../../_i18n/signer";
import { changeLines } from "./rules-change";
import { RULES_SIGNOFF_TEXT } from "./thread-rules-signoff.text";

/**
 * A change to the kitchen's rules that widens what its agent may do, waiting for the named approver: the change
 * spelled out on the same dark slab as an order over the limit. The first action sends it to the approver's phone (the
 * QR code and link of /approve/rch_..., where they sign or decline with their passkey); the kitchen's own account may
 * also sign here, with the signer's passkey on this device. A typed yes never signs it. When it is decided, on the
 * phone or here, the card changes in place (signed, declined, lapsed) and the conversation carries on beneath.
 */
export function RulesSignOffSlab({ card }: { card: RulesCard }) {
  const tx = useText(RULES_SIGNOFF_TEXT);
  const { lang } = useLang();
  const { kitchen, account } = usePortal();
  const [phase, setPhase] = useState<"idle" | "signing" | "signed">("idle");
  const [problem, setProblem] = useState<string>();
  const [phone, setPhone] = useState<{ url: string; qrSvg: string; adds: boolean }>();
  const p = card.proposal;
  if (!p?.approval) return null;
  // A role is said as a role ("the owner"), a person by name.
  const who = signerL(p.approval.approver.name, lang);
  const Who = who.charAt(0).toUpperCase() + who.slice(1);
  const own = !!account && account.kitchen === kitchen.slug;
  const base = `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/rules/${encodeURIComponent(p.proposalId)}`;
  const lines = changeLines(card.diff, lang);
  const decided = p.approval.decided;

  if (p.state !== "waiting" && phase !== "signed") {
    if (p.state !== "signed" && p.state !== "declined" && p.state !== "expired") return null;
    return (
      <section aria-label={tx.needs(who)} data-slab={`rules-${p.state}`} className="tl-in mt-4 overflow-hidden rounded-[1.4rem] bg-safety-ink text-paper">
        <div className="p-4 pt-3.5">
          {lines.map((l) => (
            <p key={l} className={`display text-[1.1rem] leading-snug ${p.state === "signed" ? "" : "text-paper/60 line-through decoration-1"}`}>
              {l}
            </p>
          ))}
          <p className={`mt-3 flex items-center gap-2 text-[0.92rem] font-semibold ${p.state === "signed" ? "text-lime" : "text-paper/75"}`}>
            {p.state === "signed" ? <Check aria-hidden size={17} strokeWidth={2.6} /> : <X aria-hidden size={17} strokeWidth={2.6} />}
            {p.state === "signed" ? tx.signedBy(decided?.by ? signerL(decided.by, lang) : who, decided ? clock(decided.at) : "") : p.state === "declined" ? tx.declinedBy(decided?.by ? signerL(decided.by, lang) : who, decided ? clock(decided.at) : "") : tx.lapsed}
          </p>
          {decided?.note && <p className="mt-1.5 text-[0.86rem] text-paper/60">“{decided.note}”</p>}
        </div>
      </section>
    );
  }

  async function toPhone() {
    if (phone) return setPhone(undefined);
    setProblem(undefined);
    const r = await api<{ approvalId: string; mode: "passkey" | "no_device"; join?: boolean; url: string; qrSvg: string }>("GET", base);
    if (!r.ok) return setProblem(r.error.message);
    // From the kitchen's own account with no signing device yet, or in a shared test kitchen or a fresh kitchen every
    // time: the code adds the phone as one more device of the signer, then opens the change.
    if ((r.data.mode === "no_device" || r.data.join) && own) {
      const l = await api<{ url: string; qrSvg: string }>("POST", "/ui-api/account/device/link", { next: `/approve/${r.data.approvalId}` });
      if (l.ok) return setPhone({ url: l.data.url, qrSvg: l.data.qrSvg, adds: true });
      return setProblem(l.error.message);
    }
    setPhone({ url: r.data.url, qrSvg: r.data.qrSvg, adds: false });
  }

  async function sign() {
    setProblem(undefined);
    setPhase("signing");
    try {
      let ch = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("POST", `${base}/challenge`, {});
      // No passkey for the signer on this site yet: the kitchen's own account adds this device's first, then signs.
      if (!ch.ok && own && /no_passkey/.test(ch.error.code)) {
        const begin = await api<{ options: PublicKeyCredentialCreationOptionsJSON }>("POST", "/ui-api/account/device", { step: "begin" });
        if (!begin.ok) throw new Error(begin.error.message);
        const reg = await startRegistration({ optionsJSON: begin.data.options });
        const done = await api<unknown>("POST", "/ui-api/account/device", { step: "verify", response: reg });
        if (!done.ok) throw new Error(done.error.message);
        ch = await api<{ options: PublicKeyCredentialRequestOptionsJSON }>("POST", `${base}/challenge`, {});
      }
      if (!ch.ok) throw new Error(ch.error.message);
      const response = await startAuthentication({ optionsJSON: ch.data.options });
      const r = await api<unknown>("POST", base, { proof: { kind: "webauthn", response } });
      if (!r.ok) throw new Error(r.error.message);
      setPhase("signed");
    } catch (err) {
      setPhase("idle");
      const fromPrompt = typeof (err as { name?: string }).name === "string" && (err as { name: string }).name !== "Error";
      if (!fromPrompt) setProblem((err as Error).message);
      else {
        const q = passkeyProblemL(err, lang);
        if (!q.cancelled) setProblem(`${q.title} ${q.body}`);
      }
    }
  }

  return (
    <section aria-label={tx.needs(who)} data-slab="rules-waiting" className="tl-in mt-4 overflow-hidden rounded-[1.4rem] bg-safety-ink text-paper">
      <div className="hazard-thin h-1.5" />
      <div className="p-4 pt-3.5">
        <p className="text-[0.78rem] font-medium tracking-wide text-safety">{tx.needs(who)}</p>
        {lines.map((l) => (
          <p key={l} className="display mt-1.5 text-[1.25rem] leading-snug">
            {l}
          </p>
        ))}
        <p className="mt-2 text-[0.86rem] leading-snug text-paper/55">{tx.nothing}</p>
        {phase === "signed" ? (
          <p className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper/10 text-[0.95rem] font-semibold text-lime">
            <Check aria-hidden size={18} strokeWidth={2.6} /> {tx.signed}
          </p>
        ) : (
          <>
            <button type="button" onClick={() => void toPhone()} aria-expanded={!!phone} className="mt-4 flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full bg-lime px-4 text-center text-[1rem] font-semibold text-ink transition-transform active:scale-[0.98]">
              {phone ? tx.hidePhone : tx.toPhone(who)}
            </button>
            {own && (
              <button type="button" disabled={phase === "signing"} onClick={() => void sign()} className="mt-2 inline-flex min-h-10 items-center gap-2 text-[0.88rem] text-paper/70 underline underline-offset-4 hover:text-paper disabled:opacity-60">
                <ScanFace aria-hidden size={17} />
                {phase === "signing" ? tx.signing : tx.signHere}
              </button>
            )}
            {account?.shared && own && phase === "idle" && !phone && <p className="mt-1 text-[0.8rem] leading-snug text-paper/55">{tx.testSigner(who)}</p>}
          </>
        )}
        {problem && <p className="mt-2 text-[0.88rem] text-safety">{problem}</p>}
        {phone && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-paper p-3 text-ink">
            <span aria-hidden className="block size-32 shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: phone.qrSvg }} />
            <p className="min-w-0 flex-1 basis-40 text-[0.88rem] leading-snug">
              {phone.adds ? tx.phoneAddHint(who) : tx.phoneHint(Who)}{" "}
              <a className="font-semibold text-petrol underline underline-offset-4" href={phone.url}>
                {tx.openLink}
              </a>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
