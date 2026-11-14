"use client";

import { Check, CircleCheck, History, Package, Pencil, Plus, Repeat, ScrollText, Search, Sparkles, Truck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useText } from "../_i18n/provider";
import { Switch, buttonClass } from "./kit";
import { ThreadCard } from "./thread";
import { FactRows, Thumb } from "./widgets";
import { WIDGET_TEXT } from "./widgets.text";

/**
 * More of the thread's widgets (web/docs/DESIGN.md, 7b): showing things, the kitchen's rules, and the set-up
 * interview. The same restraint as the first set: each is a short list in a card, one action per row, the editor
 * one tap away. Presentational, on plain data already worded for the buyer's language.
 */

const quiet = "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.86rem] font-medium text-petrol transition-colors duration-150 hover:bg-petrol-soft pointer-coarse:min-h-11";

/** A list that shows its first few rows and then "show more": never a wall. */
function useShortList<T>(rows: T[], max: number) {
  const [all, setAll] = useState(false);
  return { shown: all ? rows : rows.slice(0, max), hidden: all ? 0 : Math.max(0, rows.length - max), showAll: () => setAll(true) };
}

function ShowMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  const tx = useText(WIDGET_TEXT);
  if (hidden <= 0) return null;
  return (
    <button type="button" onClick={onClick} className="mt-1.5 flex min-h-11 w-full items-center justify-center rounded-full text-[0.9rem] font-medium text-petrol transition-colors duration-150 hover:bg-petrol-soft">
      {tx.show.more(hidden)}
    </button>
  );
}

// ---------- 7. showing things ----------

export type FoundProduct = {
  id: string;
  name: string;
  pack: string;
  art?: string;
  /** What stands where a price would: "Price when opened" (prices are asked for one product at a time), or the price once known. */
  price: string;
  added?: boolean;
};

/**
 * A search result as a small grid that adds to the order: picture, name, pack, the price note and one add button.
 * At most six, then "show more". Tapping the name opens the product's facts in the thread (`onOpen`).
 */
export function ProductResults({ kind, products, onAdd, onOpen, max = 6 }: { kind: ReactNode; products: FoundProduct[]; onAdd: (id: string) => void; onOpen?: (id: string) => void; max?: number }) {
  const tx = useText(WIDGET_TEXT);
  const list = useShortList(products, max);
  return (
    <ThreadCard kind={kind} mark={<Search aria-hidden size={14} />}>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {list.shown.map((p) => (
          <li key={p.id} className="flex flex-col rounded-lg border border-line p-2.5">
            <Thumb art={p.art} className="h-20 w-full" />
            {onOpen ? (
              <button type="button" onClick={() => onOpen(p.id)} className="mt-2 text-left text-[0.9rem] font-semibold leading-snug underline-offset-2 [overflow-wrap:anywhere] hover:underline">
                {p.name}
              </button>
            ) : (
              <p className="mt-2 text-[0.9rem] font-semibold leading-snug [overflow-wrap:anywhere]">{p.name}</p>
            )}
            <p className="text-[0.8rem] leading-snug text-ink-soft tabular">{p.pack}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              <p className="min-w-0 text-[0.78rem] leading-tight text-ink-soft tabular">{p.price}</p>
              <button
                type="button"
                aria-label={`${p.added ? tx.show.added : tx.show.add}: ${p.name}`}
                disabled={p.added}
                onClick={() => onAdd(p.id)}
                className={`flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-default ${p.added ? "bg-good-soft text-good" : "bg-petrol text-paper hover:bg-petrol-deep"}`}
              >
                {p.added ? <Check aria-hidden size={18} strokeWidth={2.6} /> : <Plus aria-hidden size={18} strokeWidth={2.4} />}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ShowMore hidden={list.hidden} onClick={list.showAll} />
    </ThreadCard>
  );
}

/** One product's facts, with one button to add it. */
export function ProductFacts({ kind, name, pack, art, price, rows, add }: { kind: ReactNode; name: string; pack: string; art?: string; price?: string; rows: { label: string; value: ReactNode }[]; add?: { label: string; onClick: () => void; added?: boolean } }) {
  return (
    <ThreadCard kind={kind} mark={<Package aria-hidden size={14} />}>
      <div className="flex items-start gap-3">
        <Thumb art={art} className="size-16" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug [overflow-wrap:anywhere]">{name}</p>
          <p className="text-[0.84rem] leading-snug text-ink-soft tabular">{pack}</p>
        </div>
        {price && <p className="display shrink-0 text-[1.2rem] leading-tight tabular">{price}</p>}
      </div>
      <div className="mt-3">
        <FactRows rows={rows} />
      </div>
      {add && (
        <button type="button" disabled={add.added} onClick={add.onClick} className={`${buttonClass(add.added ? "secondary" : "primary", "md")} mt-3 w-full`}>
          {add.added ? <Check aria-hidden size={16} strokeWidth={2.6} /> : <Plus aria-hidden size={16} />}
          {add.label}
        </button>
      )}
    </ThreadCard>
  );
}

export type PastOrder = {
  id: string;
  /** "Mon 9.11." */
  when: string;
  /** "400 L lactose-free milk, 24 L oat drink" */
  summary: string;
  total: string;
  /** "Placed by the agent", "OK'd by Aino". */
  note?: string;
};

/** Order history as a short list, each row with "order again" (it opens the order card for confirming, it does not order). */
export function HistoryList({ kind, orders, onAgain, max = 3 }: { kind: ReactNode; orders: PastOrder[]; onAgain: (id: string) => void; max?: number }) {
  const tx = useText(WIDGET_TEXT);
  const list = useShortList(orders, max);
  return (
    <ThreadCard kind={kind} mark={<History aria-hidden size={14} />}>
      <ul className="divide-y divide-line">
        {list.shown.map((o) => (
          <li key={o.id} className="py-2.5 first:pt-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold tabular">{o.when}</p>
              <p className="shrink-0 font-semibold tabular">{o.total}</p>
            </div>
            <div className="mt-0.5 flex items-end justify-between gap-2">
              <p className="min-w-0 text-[0.88rem] leading-snug text-ink-soft [overflow-wrap:anywhere]">
                {o.summary}
                {o.note && <span className="block text-[0.8rem]">{o.note}</span>}
              </p>
              <button type="button" onClick={() => onAgain(o.id)} className={`${quiet} -mr-2`}>
                <Repeat aria-hidden size={15} />
                {tx.show.again}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ShowMore hidden={list.hidden} onClick={list.showAll} />
    </ThreadCard>
  );
}

export type StandingOrder = {
  id: string;
  /** "Lactose-free milk" */
  name: string;
  /** "400 L, Mondays and Thursdays" */
  rhythm: string;
  /** "Next: Mon 16.11." */
  next?: string;
  paused: boolean;
  /** Something the agent noticed: "crept from 10 L to 14 L in four weeks". */
  note?: string;
};

/** Standing orders: see them, pause one with a switch (and un-pause it the same way), change its amount or day. */
export function StandingOrders({ kind, items, onPause, onChange }: { kind: ReactNode; items: StandingOrder[]; onPause: (id: string, paused: boolean) => void; onChange?: (id: string) => void }) {
  const tx = useText(WIDGET_TEXT);
  return (
    <ThreadCard kind={kind} mark={<Repeat aria-hidden size={14} />}>
      <ul className="divide-y divide-line">
        {items.map((s) => (
          <li key={s.id} className="py-2.5 first:pt-0.5">
            <div className="flex items-center justify-between gap-3">
              <p className={`min-w-0 font-semibold leading-snug [overflow-wrap:anywhere] ${s.paused ? "text-ink-soft" : ""}`}>{s.name}</p>
              <Switch on={!s.paused} onChange={(on) => onPause(s.id, !on)} className="shrink-0 flex-row-reverse">
                <span className="text-[0.84rem] text-ink-soft">{s.paused ? tx.show.pause : tx.show.running}</span>
              </Switch>
            </div>
            <div className="flex items-end justify-between gap-2">
              <p className="min-w-0 text-[0.88rem] leading-snug text-ink-soft tabular">
                {s.rhythm}
                {s.next && !s.paused && <span className="block text-[0.8rem]">{s.next}</span>}
                {s.note && <span className="block text-[0.82rem] text-notice">{s.note}</span>}
              </p>
              {onChange && (
                <button type="button" onClick={() => onChange(s.id)} className={`${quiet} -mr-2`}>
                  <Pencil aria-hidden size={14} />
                  {tx.show.change}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </ThreadCard>
  );
}

/** A delivery: where it is, as three or four steps in a row. */
export function DeliveryCard({ kind, title, detail, steps }: { kind: ReactNode; title: string; detail?: string; steps: { label: string; at?: string; state: "done" | "now" | "next" }[] }) {
  return (
    <ThreadCard kind={kind} mark={<Truck aria-hidden size={14} />}>
      <p className="font-semibold leading-snug">{title}</p>
      {detail && <p className="text-[0.88rem] leading-snug text-ink-soft tabular">{detail}</p>}
      <ol className="mt-3 grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li key={s.label} className="relative pr-2">
            {i < steps.length - 1 && <span aria-hidden className={`absolute left-3 right-0 top-[0.55rem] h-0.5 ${s.state === "done" ? "bg-petrol" : "bg-line-strong"}`} />}
            <span aria-hidden className={`relative block size-[1.15rem] rounded-full border-2 ${s.state === "done" ? "border-petrol bg-petrol" : s.state === "now" ? "border-petrol bg-paper shadow-[0_0_0_3px_var(--color-petrol-soft)]" : "border-line-strong bg-paper"}`} />
            <p className={`mt-1.5 text-[0.82rem] leading-tight ${s.state === "next" ? "text-ink-soft" : "font-medium"}`}>{s.label}</p>
            {s.at && <p className="text-[0.76rem] text-ink-soft tabular">{s.at}</p>}
          </li>
        ))}
      </ol>
    </ThreadCard>
  );
}

export type RememberedItem = { id: string; text: string; source?: string };

/** What the agent remembers about this kitchen: each line can be corrected or forgotten. */
export function MemoryList({ kind, items, onEdit, onForget, max = 5 }: { kind: ReactNode; items: RememberedItem[]; onEdit?: (id: string) => void; onForget: (id: string) => void; max?: number }) {
  const tx = useText(WIDGET_TEXT);
  const list = useShortList(items, max);
  return (
    <ThreadCard kind={kind} tone="agent" mark={<Sparkles aria-hidden size={14} />}>
      <ul className="divide-y divide-lavender-mid/60">
        {list.shown.map((m) => (
          <li key={m.id} className="flex items-center gap-1 py-2 first:pt-0">
            <p className="min-w-0 flex-1 text-[0.92rem] leading-snug">
              {m.text}
              {m.source && <span className="block text-[0.8rem] text-ink-soft">{m.source}</span>}
            </p>
            {onEdit && (
              <button type="button" onClick={() => onEdit(m.id)} className={quiet}>
                {tx.show.edit}
              </button>
            )}
            <button type="button" onClick={() => onForget(m.id)} className={`${quiet} -mr-2 text-ink-soft`}>
              {tx.show.forget}
            </button>
          </li>
        ))}
      </ul>
      <ShowMore hidden={list.hidden} onClick={list.showAll} />
    </ThreadCard>
  );
}

// ---------- 8. your rules ----------

export type RuleRow = {
  id: string;
  /** "Your agent may spend alone" */
  label: string;
  /** "500 € per order" */
  value: string;
  /** A second line when it helps: "Above that, Aino OKs it on her phone". */
  detail?: string;
};

/**
 * "Your rules": what the agent may do, as a sheet a person reads in ten seconds. Each row can be changed (the page
 * then shows `RuleChange` for it). `footer` is for the set-up interview's last step.
 */
export function RulesSheet({ kind, title, rows, onChange, footer }: { kind: ReactNode; title?: string; rows: RuleRow[]; onChange?: (id: string) => void; footer?: ReactNode }) {
  const tx = useText(WIDGET_TEXT);
  return (
    <ThreadCard kind={kind} mark={<ScrollText aria-hidden size={14} />}>
      {title && <h3 className="display mb-1 text-[1.35rem] leading-tight">{title}</h3>}
      <dl className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <dt className="text-[0.82rem] leading-snug text-ink-soft">{r.label}</dt>
              <dd className="font-semibold leading-snug tabular [overflow-wrap:anywhere]">{r.value}</dd>
              {r.detail && <dd className="text-[0.84rem] leading-snug text-ink-soft">{r.detail}</dd>}
            </div>
            {onChange && (
              <button type="button" aria-label={`${tx.show.change}: ${r.label}`} onClick={() => onChange(r.id)} className={`${quiet} -mr-2`}>
                {tx.show.change}
              </button>
            )}
          </div>
        ))}
      </dl>
      {footer && <div className="mt-2">{footer}</div>}
    </ThreadCard>
  );
}

/**
 * Changing one rule: the control (`children`: a stepper, chips), then before and after in one line each, and the
 * kitchen's person confirming. The button's words say what the rule becomes. Nothing changes until it is pressed.
 */
export function RuleChange({ kind, title, children, before, after, note, confirm, onConfirm, onCancel, changed, done }: {
  kind: ReactNode;
  /** "What your agent may spend alone" */
  title: string;
  children: ReactNode;
  before: string;
  after: string;
  /** What follows from it, when it is not obvious: "Orders up to 800 € will no longer ask Aino." */
  note?: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** False while `after` equals `before`: the button waits. */
  changed: boolean;
  /** Confirmed: the card settles to the new rule. */
  done?: boolean;
}) {
  const tx = useText(WIDGET_TEXT);
  return (
    <ThreadCard kind={kind} mark={<Pencil aria-hidden size={13} />} aside={done ? <span className="inline-flex items-center gap-1 text-good"><Check aria-hidden size={13} strokeWidth={2.8} />{tx.more.saved}</span> : undefined}>
      <p className="text-[1.02rem] font-semibold leading-snug">{title}</p>
      {!done && <div className="mt-3">{children}</div>}
      <dl className="mt-3 space-y-1 rounded-lg bg-surface px-3 py-2.5 text-[0.92rem] leading-snug">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-ink-soft">{done ? tx.show.was : tx.show.before}</dt>
          <dd className={`text-right tabular ${changed || done ? "text-ink-soft line-through decoration-ink-soft/50" : "font-semibold"}`}>{before}</dd>
        </div>
        {(changed || done) && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-ink-soft">{tx.show.after}</dt>
            <dd className="text-right font-semibold tabular">{after}</dd>
          </div>
        )}
      </dl>
      {note && (changed || done) && <p className="mt-2 text-[0.86rem] leading-snug text-ink-soft">{note}</p>}
      {!done && (
        <>
          <button type="button" disabled={!changed} onClick={onConfirm} className={`${buttonClass("go", "lg")} mt-3 w-full disabled:cursor-not-allowed disabled:opacity-55`}>
            <span className="tabular">{confirm}</span>
          </button>
          <button type="button" onClick={onCancel} className="mt-1.5 flex min-h-11 w-full items-center justify-center rounded-full text-[0.9rem] font-medium text-petrol transition-colors duration-150 hover:bg-petrol-soft">
            {tx.show.cancel}
          </button>
        </>
      )}
    </ThreadCard>
  );
}

// ---------- 9. the set-up interview ----------

/**
 * The first screen a new restaurant sees: what this is, the three things it will be asked and why, how long it
 * takes, and one button. Being asked should feel like being welcomed by someone competent.
 */
export function SetupWelcome({ title, lead, points, time, start, onStart }: { title: string; lead: string; points: { title: string; why: string }[]; time: string; start: string; onStart: () => void }) {
  return (
    <div className="flex flex-col gap-4 px-1">
      <header>
        <h2 className="display text-[1.8rem] leading-[1.1] [overflow-wrap:anywhere] sm:text-[2.1rem]">{title}</h2>
        <p className="mt-2 text-[1rem] leading-relaxed text-ink-soft">{lead}</p>
      </header>
      <ol className="grid gap-2">
        {points.map((p, i) => (
          <li key={p.title} className="flex items-start gap-3 rounded-xl border border-line bg-paper p-3.5">
            <span className="display flex size-8 shrink-0 items-center justify-center rounded-full bg-petrol-soft text-[0.95rem] text-petrol-deep tabular">{i + 1}</span>
            <p className="min-w-0 leading-snug">
              <span className="block font-semibold">{p.title}</span>
              <span className="block text-[0.88rem] text-ink-soft">{p.why}</span>
            </p>
          </li>
        ))}
      </ol>
      <div>
        <button type="button" onClick={onStart} className={`${buttonClass("go", "lg")} w-full`}>
          {start}
        </button>
        <p className="mt-2 text-center text-[0.84rem] text-ink-soft">{time}</p>
      </div>
    </div>
  );
}

/**
 * One question of the interview: a quiet line of progress, the answer widget (`children`: a ChoiceAnswer, an
 * AmountAnswer with its default already set), and the way on. "Next" keeps the default; "Back" loses nothing.
 */
export function SetupStep({ step, of, children, onBack, next, onNext }: { step: number; of: number; children: ReactNode; onBack?: () => void; /** The way on, when the answer widget itself does not move the interview forward. */ next?: string; onNext?: () => void }) {
  const tx = useText(WIDGET_TEXT);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1" role="progressbar" aria-valuemin={1} aria-valuemax={of} aria-valuenow={step} aria-valuetext={tx.show.step(step, of)}>
        <div className="flex flex-1 gap-1.5">
          {Array.from({ length: of }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${i < step ? "bg-petrol" : "bg-lavender-mid"}`} />
          ))}
        </div>
        <span className="shrink-0 text-[0.8rem] text-ink-soft tabular">{tx.show.step(step, of)}</span>
      </div>
      {children}
      <div className="flex items-center justify-between gap-3">
        {onBack ? (
          <button type="button" onClick={onBack} className={`${quiet} -ml-1`}>
            {tx.show.back}
          </button>
        ) : (
          <span />
        )}
        {onNext && (
          <button type="button" onClick={onNext} className={buttonClass("primary", "md")}>
            {next ?? tx.show.next}
          </button>
        )}
      </div>
    </div>
  );
}

/** The interview's end: the rules are set and a device is added. One line each, then into the agent's home. */
export function SetupDone({ title, lines, start, onStart }: { title: string; lines: string[]; start: string; onStart: () => void }) {
  return (
    <div className="flex flex-col gap-4 px-1">
      <h2 className="display text-[1.7rem] leading-[1.1] sm:text-[2rem]">{title}</h2>
      <ul className="grid gap-2">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2.5 text-[0.98rem] leading-snug">
            <CircleCheck aria-hidden size={19} className="mt-[0.1em] shrink-0 text-good" />
            {l}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onStart} className={`${buttonClass("go", "lg")} w-full`}>
        {start}
      </button>
    </div>
  );
}
