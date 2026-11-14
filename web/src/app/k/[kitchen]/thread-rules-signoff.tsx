"use client";

import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Check, ScanFace } from "lucide-react";
import { useState } from "react";
import { api } from "../../_client/api";
import { useLang, useText } from "../../_i18n/provider";
import { passkeyProblemL } from "../../_ui/passkey.text";
import type { RulesCard } from "@/server/thread/types";
import { usePortal } from "./portal";
import { RULES_SIGNOFF_TEXT } from "./thread-rules-signoff.text";

/**
 * A change to the kitchen's rules that widens what its agent may do, waiting for the named approver: the change
 * spelled out on the same dark slab as an order over the limit, and the approver's passkey as the one action. The
 * passkey signs this exact change (POST .../rules/{proposalId}/challenge, then .../rules/{proposalId}); a typed yes
 * never does. On a shared test account the buyer's browser is the approver, and the passkey step still happens.
 */
export function RulesSignOffSlab({ card }: { card: RulesCard }) {
  const tx = useText(RULES_SIGNOFF_TEXT);
  const { lang } = useLang();
  const { kitchen, account } = usePortal();
  const [phase, setPhase] = useState<"idle" | "signing" | "signed">("idle");
  const [problem, setProblem] = useState<string>();
  const p = card.proposal;
  if (!p?.approval || (p.state !== "waiting" && phase !== "signed")) return null;
  const who = p.approval.approver.name;
  const own = !!account && account.kitchen === kitchen.slug;
  const base = `/ui-api/kitchens/${encodeURIComponent(kitchen.slug)}/rules/${encodeURIComponent(p.proposalId)}`;
  const added = (d: RulesCard["diff"][number]) => d.after.split(", ").filter((x) => x && !d.before.split(", ").includes(x)).join(", ");
  const removed = (d: RulesCard["diff"][number]) => d.before.split(", ").filter((x) => x && !d.after.split(", ").includes(x)).join(", ");
  const lines = card.diff
    .filter((d) => d.widens || d.field === "signer")
    .map((d) =>
      d.field === "groups" ? tx.groups(added(d).toLowerCase()) : d.field === "perOrderLimitEur" ? tx.limit(`${d.after} €`) : d.field === "weeklyBudgetEur" ? tx.budget(`${d.after} €`) : d.field === "forbiddenAllergens" ? tx.unforbid(removed(d).replaceAll("_", " ")) : d.field === "requiredAttributes" ? tx.unrequire(removed(d).replaceAll("_", " ")) : d.field === "maxLeadDays" ? tx.lead(d.after) : d.field === "substitution" ? tx.substitution : tx.signer(d.after),
    );

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
        {account?.shared && own && phase !== "signed" && <p className="mt-3 text-[0.8rem] leading-snug text-paper/65">{tx.testSigner(who)}</p>}
        {phase === "signed" ? (
          <p className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper/10 text-[0.95rem] font-semibold text-lime">
            <Check aria-hidden size={18} strokeWidth={2.6} /> {tx.signed}
          </p>
        ) : own ? (
          <button type="button" disabled={phase === "signing"} onClick={() => void sign()} className="mt-4 flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full bg-lime text-[1rem] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-70">
            <ScanFace aria-hidden size={21} />
            {phase === "signing" ? tx.signing : tx.sign}
          </button>
        ) : (
          <p className="mt-4 text-[0.9rem] text-paper/75">{tx.waits(who)}</p>
        )}
        {problem && <p className="mt-2 text-[0.88rem] text-safety">{problem}</p>}
      </div>
    </section>
  );
}
