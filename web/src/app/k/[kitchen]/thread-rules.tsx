"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useFormat, useText } from "../../_i18n/provider";
import { Chip, buttonClass } from "../../_ui/kit";
import { ThreadCard } from "../../_ui/thread";
import type { RulesCard as RulesCardT, RulesChange, RulesSnapshot, ThreadAction } from "@/server/thread/types";
import { DEPARTMENT_NAME } from "./catalogue.text";
import { DOOR_TEXT } from "../door.text";
import { THREAD_RULES_TEXT } from "./thread-rules.text";

/**
 * The kitchen's rules in the thread (docs/agent-thread.md "Widgets": rules): the signed mandate and the stated rules
 * as plain facts; a change is tapped or typed, shown as before and after, and signed here by the kitchen's own person.
 * Nothing on this card signs anything by itself: `rules_propose` only shows, `rules_sign` signs, the server decides
 * what this browser may sign and says why not.
 */
export function RulesCardView({ card, busy, tap }: { card: RulesCardT; busy: boolean; tap: (action: ThreadAction, label: string) => void }) {
  const tx = useText(THREAD_RULES_TEXT);
  const dx = useText(DOOR_TEXT);
  const f = useFormat();
  const p = card.proposal;
  const open = p?.state === "open";
  const words = wordsFor(tx, dx, f, card);
  return (
    <ThreadCard
      kind={tx.kind}
      mark={<ShieldCheck aria-hidden size={15} />}
      tone={p?.state === "signed" ? "good" : "agent"}
      aside={f.day(card.validUntil.slice(0, 10))}
      actions={
        open ? (
          <>
            {p.canSign && (
              <button type="button" disabled={busy} className={buttonClass(card.diff.some((d) => d.widens) ? "safety" : "go", "sm")} onClick={() => tap({ type: "rules_sign", proposalId: p.proposalId }, card.editable.as ? tx.sign(card.editable.as) : tx.signGeneric)}>
                {card.editable.as ? tx.sign(card.editable.as) : tx.signGeneric}
              </button>
            )}
            <button type="button" disabled={busy} className={buttonClass("quiet", "sm")} onClick={() => tap({ type: "rules_cancel", proposalId: p.proposalId }, tx.drop)}>
              {tx.drop}
            </button>
          </>
        ) : undefined
      }
    >
      <p className="text-[0.8rem] text-ink-soft">{tx.signedMandate(f.day(card.validUntil.slice(0, 10)))}</p>
      {open || (p?.state === "signed" && card.diff.length) ? <Diff card={card} words={words} /> : <Facts s={card.current} words={words} />}
      {p?.state === "signed" && <p className="mt-3 text-[0.92rem] font-semibold text-good">{tx.signed(p.signedAs ?? card.mandateId)}</p>}
      {p?.state === "cancelled" && <p className="mt-3 text-[0.92rem] text-ink-soft">{tx.dropped}</p>}
      {open && <p className="mt-3 text-[0.88rem] text-ink-soft">{p.canSign ? tx.nothingSigned : (tx.why[p.why ?? ""] ?? tx.why.terms_fixed)}</p>}
      {card.stated.length > 0 && !open && (
        <div className="mt-3.5">
          <p className="text-[0.76rem] text-ink-soft">{tx.stated}</p>
          <ul className="mt-1 space-y-0.5 text-[0.92rem]">
            {card.stated.map((r) => (
              <li key={r.id}>{r.text}</li>
            ))}
          </ul>
        </div>
      )}
      {!p && card.editable.narrow && <Editor card={card} busy={busy} tap={tap} />}
      {!p && !card.editable.narrow && card.editable.why && <p className="mt-3 text-[0.86rem] text-ink-soft">{tx.why[card.editable.why]}</p>}
    </ThreadCard>
  );
}

type Words = (field: string, v: string) => string;

function Facts({ s, words }: { s: RulesSnapshot; words: Words }) {
  const tx = useText(THREAD_RULES_TEXT);
  const rows = (["perOrderLimitEur", "weeklyBudgetEur", "signer", "forbiddenAllergens", "requiredAttributes", "maxLeadDays", "substitution", ...(s.groups ? ["groups"] : [])] as const).map((k) => ({ k, label: tx.field[k], value: words(k, valueOf(s, k)) }));
  return (
    <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
      {rows.map((r) => (
        <div key={r.k} className={`min-w-0 ${r.k === "groups" || r.k === "substitution" ? "col-span-2" : ""}`}>
          <dt className="text-[0.76rem] text-ink-soft">{r.label}</dt>
          <dd className="mt-0.5 text-[0.95rem] font-semibold leading-snug">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Diff({ card, words }: { card: RulesCardT; words: Words }) {
  const tx = useText(THREAD_RULES_TEXT);
  return (
    <table className="mt-2.5 w-full text-left text-[0.92rem]">
      <thead>
        <tr className="text-[0.76rem] text-ink-soft">
          <th className="py-1 pr-3 font-normal">{tx.change}</th>
          <th className="py-1 pr-3 font-normal">{tx.before}</th>
          <th className="py-1 font-normal">{tx.after}</th>
        </tr>
      </thead>
      <tbody>
        {card.diff.map((d) => (
          <tr key={d.field} className="border-t border-line/70 align-top">
            <td className="py-1.5 pr-3 text-ink-soft">{tx.field[d.field] ?? d.field}</td>
            <td className="py-1.5 pr-3 line-through decoration-ink-soft/50">{words(d.field, d.before)}</td>
            <td className="py-1.5 font-semibold">
              {words(d.field, d.after)}
              <span className={`ml-1.5 whitespace-nowrap text-[0.76rem] font-normal ${d.widens ? "text-notice" : "text-good"}`}>{d.widens ? tx.widens : tx.narrows}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Values as words in the buyer's language: euros, days, allergen and claim names, the substitution rule. */
function wordsFor(tx: (typeof THREAD_RULES_TEXT)["en"], dx: (typeof DOOR_TEXT)["en"], f: ReturnType<typeof useFormat>, card: RulesCardT): Words {
  return (field, v) => {
    if (v === "") return tx.none;
    if (field === "perOrderLimitEur" || field === "weeklyBudgetEur") return `${f.num(Number(v))} €`;
    if (field === "maxLeadDays") return tx.days(v);
    if (field === "forbiddenAllergens") return v.split(", ").map((a) => dx.allergens[a] ?? a).join(", ");
    if (field === "requiredAttributes") return v.split(", ").map((c) => dx.claims[c] ?? f.attr(c)).join(", ");
    if (field === "substitution") return dx.subs[v] ?? v;
    if (field === "groups") return f.lang === "en" ? v : v.split(", ").map((n) => DEPARTMENT_NAME[f.lang as "fi" | "sv"][card.vocabulary.groups.find((g) => g.name === n)?.id ?? ""] ?? n).join(", ");
    return v;
  };
}

function valueOf(s: RulesSnapshot, k: string): string {
  switch (k) {
    case "perOrderLimitEur":
      return String(Math.round(s.perOrderLimitCents / 100));
    case "weeklyBudgetEur":
      return String(Math.round(s.weeklyBudgetCents / 100));
    case "signer":
      return s.approvers.map((a) => a.name).join(", ");
    case "forbiddenAllergens":
      return s.forbiddenAllergens.join(", ");
    case "requiredAttributes":
      return s.requiredAttributes.join(", ");
    case "maxLeadDays":
      return String(s.maxLeadDays);
    case "substitution":
      return s.substitution;
    case "groups":
      return (s.groups ?? []).map((g) => g.name).join(", ");
    default:
      return "";
  }
}

/** Tap a rule to add it, or (an account's own session) set a limit or the signer: each shows the change first. */
function Editor({ card, busy, tap }: { card: RulesCardT; busy: boolean; tap: (action: ThreadAction, label: string) => void }) {
  const tx = useText(THREAD_RULES_TEXT);
  const dx = useText(DOOR_TEXT);
  const [limit, setLimit] = useState(Math.round(card.current.perOrderLimitCents / 100));
  const [budget, setBudget] = useState(Math.round(card.current.weeklyBudgetCents / 100));
  const [signer, setSigner] = useState(card.current.approvers[0]?.name ?? "");
  const propose = (change: RulesChange, label: string) => tap({ type: "rules_propose", change }, label);
  const forbid = card.vocabulary.forbid.filter((a) => !card.current.forbiddenAllergens.includes(a));
  const require = card.vocabulary.require.filter((c) => !card.current.requiredAttributes.includes(c));
  const changed: RulesChange = {
    ...(limit !== Math.round(card.current.perOrderLimitCents / 100) ? { perOrderLimitEur: limit } : {}),
    ...(budget !== Math.round(card.current.weeklyBudgetCents / 100) ? { weeklyBudgetEur: budget } : {}),
    ...(signer.trim() && signer.trim() !== card.current.approvers[0]?.name ? { signer: signer.trim() } : {}),
  };
  return (
    <div className="mt-4 space-y-3 border-t border-line/70 pt-3">
      <ChipRow label={tx.addNever} items={forbid.map((a) => ({ id: a, label: dx.allergens[a] ?? a }))} busy={busy} onPick={(id, label) => propose({ forbidAdd: [id] }, `${tx.addNever}: ${label}`)} />
      <ChipRow label={tx.addAlways} items={require.map((c) => ({ id: c, label: dx.claims[c] ?? c }))} busy={busy} onPick={(id, label) => propose({ requireAdd: [id] }, `${tx.addAlways}: ${label}`)} />
      {card.editable.terms && (
        <fieldset className="space-y-2">
          <legend className="text-[0.76rem] text-ink-soft">{tx.limits}</legend>
          <Stepper label={tx.field.perOrderLimitEur} value={limit} step={50} min={0} max={50000} onChange={setLimit} />
          <Stepper label={tx.field.weeklyBudgetEur} value={budget} step={250} min={10} max={200000} onChange={setBudget} />
          <label className="flex items-center justify-between gap-3 text-[0.9rem]">
            <span>{tx.signerName}</span>
            <input value={signer} onChange={(e) => setSigner(e.target.value)} maxLength={60} className="min-h-10 w-44 rounded-lg border border-line bg-paper px-2.5 text-[0.92rem]" />
          </label>
          <button type="button" disabled={busy || !Object.keys(changed).length} className={buttonClass("secondary", "sm")} onClick={() => propose(changed, tx.propose)}>
            {tx.propose}
          </button>
        </fieldset>
      )}
    </div>
  );
}

function ChipRow({ label, items, busy, onPick }: { label: string; items: { id: string; label: string }[]; busy: boolean; onPick: (id: string, label: string) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[0.76rem] text-ink-soft">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((i) => (
          <Chip key={i.id} on={false} onClick={() => !busy && onPick(i.id, i.label)}>
            {i.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function Stepper({ label, value, step, min, max, onChange, unit = "€" }: { label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void; unit?: string }) {
  const f = useFormat();
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div className="flex items-center justify-between gap-3 text-[0.9rem]">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1">
        <button type="button" aria-label={`${label} −${step}`} className={buttonClass("quiet", "sm", "min-w-10")} onClick={() => set(value - step)}>
          −
        </button>
        <span className="min-w-20 text-center font-semibold tabular">
          {f.num(value)} {unit}
        </span>
        <button type="button" aria-label={`${label} +${step}`} className={buttonClass("quiet", "sm", "min-w-10")} onClick={() => set(value + step)}>
          +
        </button>
      </span>
    </div>
  );
}
