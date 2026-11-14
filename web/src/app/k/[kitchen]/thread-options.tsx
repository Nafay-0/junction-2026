"use client";

import { Check, ChevronDown, Minus, ReceiptText, Sparkles } from "lucide-react";
import { Art, artFor, hasArt } from "../../_ui/art";
import { useFormat, useText } from "../../_i18n/provider";
import { ThreadCard } from "../../_ui/thread";
import { Target } from "../../_ui/target";
import type { OptionView, OptionsCard as OptionsCardT, ThreadAction } from "@/server/thread/types";
import { usePortal } from "./portal";
import { THREAD_PAGE_TEXT } from "./thread.text";
import { THREAD_WORDS } from "./thread-words.text";
import { approverFor, fmtFor, leadOption, leadReasons, leftOutGroups, oneThing, otherNotes, packsText, perUnitPrice, reasonText, sharedQuiet, sharedSignoff, tradeOffs, usualNote } from "./thread-words";

/**
 * The options as one decision: the option the agent leads with, as one compact card (its picture by kind, its full
 * name, the packs, the total and the price per litre or kilo, when it arrives, two reasons, and a button that says
 * what will happen), and the others as rows beneath it, each with the one thing it differs in, opening to the full
 * trade-offs. Whatever every option shares (a sign-off, an unreported stock, the usual that is not offered) is said
 * once for the card. Everything in the buyer's language (thread-words.ts).
 */

type Tap = (action: ThreadAction, label: string) => void;

const RANK_CHIP = "rounded-full px-2 text-[0.72rem] font-semibold leading-5";

export function OptionsDecision({ card, tap, busy }: { card: OptionsCardT; tap: Tap; busy: boolean }) {
  const { kitchen } = usePortal();
  const fmt = useFormat();
  const tx = useText(THREAD_PAGE_TEXT);
  const w = useText(THREAD_WORDS);
  const f = fmtFor(fmt.lang);
  if (!card.options.length) return null;
  const lead = leadOption(card);
  const others = card.options.filter((o) => o.optionId !== lead.optionId);
  const shared = sharedSignoff(card.options);
  const quiet = sharedQuiet(card.options).filter((r) => r.code !== "instead_of_usual");
  const usual = usualNote(card, w, fmt.lang);
  const left = leftOutGroups(card, w, fmt.lang);
  const leftCount = left.reduce((s, g) => s + g.count, 0);
  const notes = otherNotes(card, w, fmt.lang);
  const open = !busy && !card.chosen;
  const rank = (o: OptionView) => w.rank[o.rank] ?? o.rank;

  const buttonLabel = (o: OptionView) => {
    const signs = o.reasons.some((r) => r.tone === "signoff") || o.signOff.length > 0;
    const who = signs ? approverFor(o.totalCents, kitchen.mandate.approvers) : undefined;
    return who ? w.sendToSign(who.name, f.money(o.totalCents)) : w.orderThis(f.money(o.totalCents));
  };
  const choose = (o: OptionView) => tap({ type: "choose", requestId: card.requestId, optionId: o.optionId }, `${o.title}, ${f.money(o.totalCents)}`);

  return (
    <ThreadCard kind={tx.kind.options} mark={<ReceiptText aria-hidden size={14} />}>
      <Lead o={lead} rank={rank(lead)} picked={card.preselected?.optionId === lead.optionId} chosen={card.chosen === lead.optionId} />
      <ul className="mt-2.5 space-y-1 text-[0.88rem] leading-snug">
        {leadReasons(lead, w, f).map((r, i) => (
          <li key={i} className="flex items-start gap-2">
            <Check aria-hidden size={14} strokeWidth={2.6} className="mt-[0.2em] shrink-0 text-good" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
      {(usual || quiet.length > 0) && (
        <p className="mt-2 text-[0.8rem] leading-snug text-ink-soft">{[usual, ...quiet.map((r) => (r.code === "stock_unconfirmed" ? w.stockQuiet : reasonText(r, w, f)))].filter(Boolean).join(" · ")}</p>
      )}
      {shared.length > 0 && (
        <p className="mt-2.5 flex items-start gap-2 rounded-md bg-safety-soft px-2.5 py-1.5 text-[0.84rem] leading-snug">
          <Target size={14} tone="safety" className="mt-[0.15em] shrink-0" />
          {shared.map((r) => reasonText(r, w, f)).join(" ")}
        </p>
      )}
      {open ? (
        <button type="button" onClick={() => choose(lead)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-lime px-4 text-center text-[0.92rem] font-semibold leading-snug text-ink transition-colors duration-150 hover:bg-lime-hover">
          {buttonLabel(lead)}
        </button>
      ) : null}

      {others.length > 0 && (
        <div className="mt-3.5 border-t border-line/70 pt-2.5">
          <p className="text-[0.76rem] font-medium uppercase tracking-wide text-ink-soft">{w.others}</p>
          <ul className="mt-1 divide-y divide-line/60">
            {others.map((o) => {
              const t = tradeOffs(o, shared, w, f);
              const isChosen = card.chosen === o.optionId;
              return (
                <li key={o.optionId}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-start gap-2.5 py-2.5 [&::-webkit-details-marker]:hidden">
                      <span className={`${RANK_CHIP} mt-0.5 shrink-0 ${isChosen ? "bg-petrol-soft text-petrol-deep" : "bg-surface text-ink-soft"}`}>{isChosen ? w.chosen : rank(o)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9rem] font-semibold leading-snug [overflow-wrap:anywhere]">{o.title}</span>
                        <span className="block text-[0.82rem] leading-snug text-ink-soft">{oneThing(o, lead, w, f)}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[0.92rem] font-semibold tabular">{f.money(o.totalCents)}</span>
                        <ChevronDown aria-hidden size={15} className="ml-auto mt-0.5 text-ink-soft transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
                      </span>
                    </summary>
                    <div className="pb-3 pl-1">
                      <p className="text-[0.82rem] text-ink-soft">
                        {[packsText(o, w, f), perUnitPrice(o, w, f), tx.deliver(f.day(o.deliveryDate)), o.orderBy ? tx.orderBy(f.clock(o.orderBy)) : ""].filter(Boolean).join(" · ")}
                      </p>
                      <ul className="mt-1.5 space-y-1 text-[0.84rem] leading-snug">
                        {t.pros.map((x, i) => (
                          <li key={`p${i}`} className="flex items-start gap-2">
                            <Check aria-hidden size={13} strokeWidth={2.6} className="mt-[0.2em] shrink-0 text-good" />
                            <span>{x}</span>
                          </li>
                        ))}
                        {t.cons.map((x, i) => (
                          <li key={`c${i}`} className="flex items-start gap-2 text-ink-soft">
                            <Minus aria-hidden size={13} strokeWidth={2.6} className="mt-[0.2em] shrink-0 text-notice" />
                            <span>{x}</span>
                          </li>
                        ))}
                        {t.signoff.map((x, i) => (
                          <li key={`s${i}`} className="flex items-start gap-2">
                            <Target size={13} tone="safety" className="mt-[0.2em] shrink-0" />
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                      {open && (
                        <button type="button" onClick={() => choose(o)} className="mt-2.5 inline-flex min-h-10 w-full items-center justify-center rounded-full border border-line-strong bg-paper px-4 text-center text-[0.88rem] font-semibold leading-snug text-ink hover:border-ink-soft hover:bg-mist">
                          {buttonLabel(o)}
                        </button>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {leftCount > 0 && (
        <details className="group mt-2 text-[0.82rem]">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden size={14} className="-rotate-90 transition-transform duration-150 group-open:rotate-0 motion-reduce:transition-none" />
            {w.leftOut(leftCount)}
          </summary>
          <ul className="mt-1.5 space-y-0.5 pl-5 text-ink-soft">
            {left.map((g) => (
              <li key={g.label}>
                <span className="tabular">{g.count}</span> · {g.label}
              </li>
            ))}
          </ul>
        </details>
      )}
      {notes.length > 0 && <p className="mt-2 text-[0.82rem] leading-snug text-ink-soft">{notes.join(" ")}</p>}
    </ThreadCard>
  );
}

function Lead({ o, rank, picked, chosen }: { o: OptionView; rank: string; picked: boolean; chosen: boolean }) {
  const fmt = useFormat();
  const tx = useText(THREAD_PAGE_TEXT);
  const w = useText(THREAD_WORDS);
  const f = fmtFor(fmt.lang);
  const main = [...o.lines].sort((a, b) => b.quantity * (b.packSize ?? 1) - a.quantity * (a.packSize ?? 1))[0];
  const art = main ? artFor({ name: main.name, category: o.category, unit: main.unit, packSize: main.packSize }) : undefined;
  const per = perUnitPrice(o, w, f);
  return (
    <div>
      <div className="flex items-start gap-3">
        {hasArt(art) && (
          <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-surface">
            <Art k={art} sizes="64px" cover />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`${RANK_CHIP} ${chosen ? "bg-petrol-soft text-petrol-deep" : "bg-lime text-ink"}`}>{chosen ? w.chosen : rank}</span>
            {picked && !chosen && (
              <span className="inline-flex items-center gap-1 text-[0.76rem] font-medium text-lavender-deep">
                <Sparkles aria-hidden size={12} />
                {w.agentsPick}
              </span>
            )}
          </p>
          <p className="mt-1 text-[0.98rem] font-semibold leading-snug [overflow-wrap:anywhere]">{o.title}</p>
          <p className="text-[0.84rem] leading-snug text-ink-soft">{[packsText(o, w, f), per].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="display text-[1.4rem] tabular">{f.money(o.totalCents)}</span>
        <span className="text-[0.84rem] text-ink-soft">{[tx.deliver(f.day(o.deliveryDate)), o.orderBy ? tx.orderBy(f.clock(o.orderBy)) : ""].filter(Boolean).join(", ")}</span>
      </p>
    </div>
  );
}
