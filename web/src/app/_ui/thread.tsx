"use client";

import Link from "next/link";
import { ArrowUp, Camera, Check, ChevronDown, ChevronLeft, CircleAlert, Clock, Maximize2, Mic, Minimize2, Minus, ReceiptText, ShieldCheck, Sparkles, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useText } from "../_i18n/provider";
import { Avatar, Badge, Spinner } from "./kit";
import { Target } from "./target";
import { THREAD_TEXT } from "./thread.text";
import { WIDGET_TEXT } from "./widgets.text";

/**
 * The thread: the buyer's one conversation with their purchasing agent, typed or spoken. It is the heart of the
 * store (web/docs/DESIGN.md, "The thread"). The buyer's turns are short bubbles; the agent's turns are one line of
 * text at most and then cards built from data, streamed as they happen.
 *
 * The card names and states follow the thread's contract, web/docs/agent-thread.md: understood, anomaly, question,
 * options, price, gate, order, memory, records, notice.
 *
 * Everything here is presentational: a page passes the words and the data, the kit gives the look and the states.
 * The cards are one family: the same anatomy (a mark, what kind of card it is, the content, the actions), the same
 * radius and hairline. Two stand apart on purpose: the anomaly card is warm and calm (something looks off, nothing
 * is refused), and the gate card is the signature moment (the dark slab, the hazard band, the gate's mark).
 */

// ---------- where the thread lives ----------

export type DockSize = "dock" | "workspace";

/** True inside the dock's working surface: the stage's header already names what is open, so a card there does not say it again. */
const StageContext = createContext(false);

/**
 * The thread's place in the shell, in two sizes the buyer moves between without losing their place.
 *
 *   phone        the primary screen: it fills the screen above the tab bar, with the shop one tab away
 *   dock         from 640 px, a column beside the shop (a side sheet below 1280 px, docked from there): a quick
 *                order while browsing
 *   workspace    from 640 px, a large centred popup over the shop: room to compare, to plan a menu, to edit an order
 *
 * `children` is the thread, `footer` the composer, `aside` goes in the header (a call button, start over).
 *
 * `stage` is the working surface: the widget the buyer is working on now (the alternatives picker, the menu sheet,
 * a long order sheet). In the workspace on a wide screen it sits beside the conversation; everywhere else it is a
 * screen pushed over the conversation with a way back. It is one element, placed by CSS, so a widget's state
 * survives a change of size. When a stage appears on a wide screen while the dock is small, the dock asks to become
 * the workspace (`onSize`): the room opens by itself when a widget needs it.
 */
export function ThreadDock({ open, onClose, name, sub, children, footer, aside, banner, id = "assistant", label, size = "dock", onSize, stage, stageTitle, onStageClose }: {
  open: boolean;
  onClose: () => void;
  name: string;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  aside?: ReactNode;
  /** A line above the header on a phone, where the dock covers the page's own top strip (the demo note). */
  banner?: ReactNode;
  id?: string;
  label: string;
  size?: DockSize;
  /** Given, the header shows the size switch and a stage can ask for the workspace. */
  onSize?: (size: DockSize) => void;
  stage?: ReactNode;
  stageTitle?: string;
  /** Back to the conversation: the page clears `stage`. */
  onStageClose?: () => void;
}) {
  const tx = useText(THREAD_TEXT);
  const wx = useText(WIDGET_TEXT);
  const ws = size === "workspace";
  const hadStage = useRef(false);
  useEffect(() => {
    const has = !!stage;
    if (has && !hadStage.current && !ws && onSize && window.matchMedia("(min-width: 1024px)").matches) onSize("workspace");
    hadStage.current = has;
  }, [stage, ws, onSize]);

  const frame = ws
    ? `sm:inset-3 sm:overflow-hidden sm:rounded-2xl sm:shadow-lg lg:inset-x-[max(1.5rem,calc((100vw-80rem)/2))] lg:inset-y-6 ${stage ? "lg:grid lg:grid-cols-[minmax(22rem,27rem)_minmax(0,1fr)]" : ""}`
    : "sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:w-[27rem] sm:rounded-l-2xl sm:shadow-lg xl:z-40 xl:rounded-none xl:border-l xl:border-lavender-mid xl:shadow-none 2xl:w-[30rem]";
  return (
    <>
      {open && <div aria-hidden className={`fade-in fixed inset-0 z-40 hidden bg-petrol-deep/45 backdrop-blur-[2px] sm:block ${ws ? "" : "xl:hidden"}`} onClick={ws && onSize ? () => onSize("dock") : onClose} />}
      <aside id={id} aria-label={label} data-size={size} className={`${open ? "flex" : "hidden"} thread-dock fixed inset-x-0 top-0 z-40 flex-col bg-lavender sm:z-50 ${frame}`}>
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${ws && stage ? "lg:border-r lg:border-lavender-mid" : ""}`}>
          {banner && <p className="on-dark bg-petrol-deep px-4 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] text-center text-[0.75rem] leading-snug text-paper/80 sm:hidden">{banner}</p>}
          <header className={`flex items-center gap-3 px-3 pb-3 sm:px-4 sm:pt-4 ${banner ? "pt-3" : "pt-[calc(0.75rem+env(safe-area-inset-top))]"} ${ws && !stage ? "mx-auto w-full max-w-[46rem]" : ""}`}>
            <button type="button" onClick={onClose} aria-label={tx.back} className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-lavender-mid hover:text-ink sm:hidden">
              <ChevronLeft aria-hidden size={22} />
            </button>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lavender-deep text-paper">
              <Sparkles aria-hidden size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="display truncate text-[1.2rem] leading-tight">{name}</h2>
              {sub && <p className="line-clamp-2 text-[0.8rem] leading-snug text-ink-soft">{sub}</p>}
            </div>
            {aside}
            {onSize && (
              <button type="button" onClick={() => onSize(ws ? "dock" : "workspace")} aria-label={ws ? wx.workspace.dock : wx.workspace.expand} title={ws ? wx.workspace.dock : wx.workspace.expand} className="hidden size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-lavender-mid hover:text-ink sm:flex">
                {ws ? <Minimize2 aria-hidden size={18} /> : <Maximize2 aria-hidden size={18} />}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={tx.close} className="hidden size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-lavender-mid hover:text-ink sm:flex">
              <X aria-hidden size={20} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-1 sm:px-4">
            <div className={ws && !stage ? "mx-auto w-full max-w-[46rem]" : ""}>{children}</div>
          </div>
          {footer && (
            <div className="border-t border-lavender-mid/70 px-3 pb-3 pt-3 sm:px-4">
              <div className={ws && !stage ? "mx-auto w-full max-w-[46rem]" : ""}>{footer}</div>
            </div>
          )}
        </div>
        {stage && (
          <section aria-label={stageTitle ?? wx.workspace.stage} className={`absolute inset-0 z-10 flex min-h-0 flex-col bg-mist ${ws ? "lg:static lg:z-auto" : ""}`}>
            <header className={`flex items-center gap-1.5 border-b border-line bg-paper px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:px-3 sm:pt-2 ${ws ? "lg:px-5 lg:py-3" : ""}`}>
              <button type="button" onClick={onStageClose} aria-label={wx.workspace.back} className={`flex min-h-11 shrink-0 items-center gap-1 rounded-full pl-2 pr-3.5 text-[0.9rem] font-medium text-petrol transition-colors hover:bg-petrol-soft ${ws ? "lg:hidden" : ""}`}>
                <ChevronLeft aria-hidden size={19} />
                {wx.workspace.backShort}
              </button>
              <h3 className={`display min-w-0 flex-1 truncate text-right text-[1.05rem] leading-tight text-ink-soft ${ws ? "lg:text-left lg:text-[1.25rem] lg:text-ink" : ""}`}>{stageTitle}</h3>
              {onStageClose && (
                <button type="button" onClick={onStageClose} aria-label={wx.workspace.back} className={`hidden size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface hover:text-ink ${ws ? "lg:flex" : ""}`}>
                  <X aria-hidden size={19} />
                </button>
              )}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5 lg:py-5">
              <div className="mx-auto w-full max-w-[56rem]">
                <StageContext.Provider value={true}>{stage}</StageContext.Provider>
              </div>
            </div>
          </section>
        )}
      </aside>
    </>
  );
}

// ---------- turns ----------

/** The thread itself: a log, read out as it grows. */
export function Thread({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) {
  return (
    <ol role="log" aria-label={label} aria-live="polite" className={`flex flex-col gap-5 ${className}`}>
      {children}
    </ol>
  );
}

/** What the buyer said, typed or spoken or photographed: a short bubble on the right. */
export function BuyerTurn({ children, via = "typed", time }: { children: ReactNode; via?: "typed" | "voice" | "photo"; time?: string }) {
  return (
    <li className="flex flex-col items-end gap-1">
      <p className="max-w-[85%] rounded-[1.25rem] rounded-br-md bg-lavender-deep px-4 py-2.5 text-[0.98rem] leading-snug text-paper">
        {via !== "typed" && (
          <span className="mr-1.5 inline-flex translate-y-[0.12em] opacity-80" aria-hidden>
            {via === "voice" ? <Mic size={15} /> : <Camera size={15} />}
          </span>
        )}
        {children}
      </p>
      {time && <span className="px-1 text-[0.72rem] text-ink-soft tabular">{time}</span>}
    </li>
  );
}

/**
 * An agent turn: one line of text at most, then its cards. While it is still working, `steps` show what it is doing
 * and a skeleton holds the place of the card that is coming.
 */
export function AgentTurn({ text, children, steps, pending = false, status }: { text?: ReactNode; children?: ReactNode; steps?: ReactNode; pending?: boolean; /** The contract's turn status; "waiting_approver" shows the sign-off wait under the cards. */ status?: "working" | "waiting_buyer" | "waiting_approver" | "done" | "failed" }) {
  return (
    <li className="lane-enter flex flex-col gap-2.5">
      {text && <p className="max-w-[60ch] px-1 text-[0.98rem] leading-relaxed text-ink">{text}</p>}
      {steps}
      {children}
      {(pending || (status === "working" && !children)) && <CardSkeleton />}
      {status === "waiting_approver" && (
        <p className="px-1">
          <VoiceStatus state="waiting" />
        </p>
      )}
    </li>
  );
}

export type Step = { key: string; text: ReactNode; state: "doing" | "done" | "failed"; detail?: ReactNode };

/**
 * What the agent is doing right now, line by line: "Searching 17 546 products", "Checking the live price of 3".
 * The line in progress turns; finished lines get a tick and go quiet. Once all are done they fold to a count.
 */
export function StepLines({ steps, fold = true }: { steps: Step[]; fold?: boolean }) {
  const tx = useText(THREAD_TEXT);
  const allDone = steps.length > 0 && steps.every((s) => s.state !== "doing");
  const [open, setOpen] = useState(false);
  const show = !fold || !allDone || open;
  return (
    <div className="px-1 text-[0.86rem]" role="status">
      {fold && allDone && (
        <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-ink-soft transition-colors hover:bg-lavender-mid/60 hover:text-ink">
          <Check aria-hidden size={14} className="text-good" strokeWidth={2.6} />
          {tx.steps(steps.length)}
          <ChevronDown aria-hidden size={14} className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {show && (
        <ul className="space-y-1.5 py-0.5">
          {steps.map((s) => (
            <li key={s.key} className={`flex items-start gap-2 leading-snug ${s.state === "doing" ? "text-ink" : "text-ink-soft"}`}>
              <span className="mt-[0.15em] flex size-4 shrink-0 items-center justify-center">
                {s.state === "doing" ? <Spinner size={13} className="text-lavender-deep" /> : s.state === "failed" ? <CircleAlert aria-hidden size={14} className="text-bad" /> : <Check aria-hidden size={14} className="text-good" strokeWidth={2.6} />}
              </span>
              <span className="min-w-0">
                {s.text}
                {s.detail && <span className="ml-1.5 text-ink-soft tabular">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The place of a card that is still on its way. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden className="rounded-xl border border-line bg-paper p-4">
      <span className="skeleton block h-3 w-24" />
      <span className="skeleton mt-3 block h-5 w-3/4" />
      {Array.from({ length: Math.max(0, lines - 1) }, (_, i) => (
        <span key={i} className="skeleton mt-2 block h-3" style={{ width: `${68 - i * 14}%` }} />
      ))}
    </div>
  );
}

// ---------- the card family ----------

type CardTone = "plain" | "agent" | "notice" | "good";

/**
 * The family's anatomy: a mark and the kind of card on one line, the content, then the actions. Every card below
 * is this with its own content; build a new kind the same way rather than inventing a new frame.
 */
export function ThreadCard({ mark, kind, aside, children, actions, tone = "plain", className = "" }: { mark?: ReactNode; kind: ReactNode; aside?: ReactNode; children: ReactNode; actions?: ReactNode; tone?: CardTone; className?: string }) {
  const ground = tone === "agent" ? "border-lavender-mid bg-paper" : tone === "notice" ? "border-notice/25 bg-notice-soft" : tone === "good" ? "border-good/20 bg-paper" : "border-line bg-paper";
  const markTone = tone === "agent" ? "bg-lavender text-lavender-deep" : tone === "notice" ? "bg-notice/12 text-notice" : tone === "good" ? "bg-good-soft text-good" : "bg-petrol-soft text-petrol";
  const inStage = useContext(StageContext);
  return (
    <article aria-label={inStage && typeof kind === "string" ? kind : undefined} className={`overflow-hidden rounded-xl border ${ground} ${className}`}>
      {inStage ? (
        aside && <header className="flex justify-end px-4 pt-3 text-[0.8rem] text-ink-soft">{aside}</header>
      ) : (
        <header className="flex items-center gap-2.5 px-4 pt-3.5">
          {mark && <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${markTone}`}>{mark}</span>}
          <p className={`min-w-0 flex-1 truncate text-[0.82rem] font-medium ${tone === "notice" ? "text-notice" : "text-ink-soft"}`}>{kind}</p>
          {aside && <span className="shrink-0 text-[0.8rem] text-ink-soft">{aside}</span>}
        </header>
      )}
      <div className={`px-4 pb-4 ${inStage && !aside ? "pt-4" : "pt-2.5"}`}>{children}</div>
      {actions && <footer className="flex flex-wrap items-center gap-2.5 border-t border-line/70 px-4 py-3">{actions}</footer>}
    </article>
  );
}

export type UnderstoodItem = { label: string; value: ReactNode; from?: "said" | "memory" };

/** What the agent understood: the need as fields. A value that came from memory, not from the buyer's words, says so. */
export function UnderstoodCard({ kind, summary, items, basedOn, alsoAsked, actions, notes, memory }: { kind: ReactNode; summary?: ReactNode; items: UnderstoodItem[]; basedOn?: ReactNode; alsoAsked?: ReactNode; actions?: ReactNode; /** Things noticed that do not stop the order, one quiet line each ("2,5 × your usual 400 L"). */ notes?: ReactNode[]; /** What memory answered instead of asking, one line each, said once in a thread. */ memory?: ReactNode[] }) {
  const tx = useText(THREAD_TEXT);
  return (
    <ThreadCard kind={kind} mark={<Check aria-hidden size={15} strokeWidth={2.6} />} actions={actions}>
      {summary && <p className="display text-[1.3rem] leading-tight">{summary}</p>}
      <dl className={`grid grid-cols-2 gap-x-4 gap-y-3 ${summary ? "mt-3.5" : ""}`}>
        {items.map((it) => (
          <div key={it.label} className="min-w-0">
            <dt className="text-[0.76rem] text-ink-soft">{it.label}</dt>
            <dd className="mt-0.5 text-[0.98rem] font-semibold leading-snug">
              {it.value}
              {it.from === "memory" && (
                <span className="ml-1.5 inline-flex translate-y-[-0.05em] items-center gap-1 rounded-full bg-lavender px-1.5 align-middle text-[0.7rem] font-medium leading-5 text-lavender-deep">
                  <Sparkles aria-hidden size={11} />
                  {tx.fromMemory}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {basedOn && <p className="mt-3.5 text-[0.84rem] leading-snug text-ink-soft">{basedOn}</p>}
      {notes && notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[0.86rem] leading-snug">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2 text-notice">
              <CircleAlert aria-hidden size={14} className="mt-[0.2em] shrink-0" />
              <span className="text-ink">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {memory && memory.length > 0 && (
        <ul className="mt-3 space-y-1 text-[0.86rem] leading-snug text-lavender-deep">
          {memory.map((m, i) => (
            <li key={i} className="flex items-start gap-2">
              <Sparkles aria-hidden size={13} className="mt-[0.2em] shrink-0" />
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}
      {alsoAsked && <p className="mt-3 rounded-md bg-surface px-3 py-2 text-[0.86rem] leading-snug">{alsoAsked}</p>}
    </ThreadCard>
  );
}

/**
 * Something looks like a slip: the amount is ten times the usual, the day is a holiday. Warm and calm, never the
 * gate's yellow: nothing is refused, the agent is asking before a price is fixed. It shows the reason as numbers.
 */
export function AnomalyCard({ kind, title, reason, usual, asked, answered, actions }: { kind: ReactNode; title: ReactNode; reason?: ReactNode; usual?: { value: ReactNode; amount: number }; asked?: { value: ReactNode; amount: number }; answered?: ReactNode; actions?: ReactNode }) {
  const tx = useText(THREAD_TEXT);
  const max = Math.max(usual?.amount ?? 0, asked?.amount ?? 0, 1);
  const bar = (amount: number) => `${Math.max(3, Math.round((amount / max) * 100))}%`;
  return (
    <ThreadCard kind={kind} tone="notice" mark={<CircleAlert aria-hidden size={16} />} actions={answered ? undefined : actions} aside={answered ? <Answered>{answered}</Answered> : undefined}>
      <p className="display text-[1.3rem] leading-tight">{title}</p>
      {reason && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink">{reason}</p>}
      {usual && asked && (
        <dl className="mt-3.5 space-y-2 text-[0.85rem]">
          {[
            { k: tx.usual, v: usual, look: "bg-notice/30" },
            { k: tx.asked, v: asked, look: "bg-notice" },
          ].map((r) => (
            <div key={r.k} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <dt className="text-ink-soft">{r.k}</dt>
              <dd className="h-2 rounded-full bg-paper/80">
                <span className={`block h-full rounded-full ${r.look}`} style={{ width: bar(r.v.amount) }} />
              </dd>
              <dd className="font-semibold tabular">{r.v.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </ThreadCard>
  );
}

/** One question, asked only when the answer changes the order. The choices are pills; `children` can be a field. */
export function QuestionCard({ kind, question, why, choices, onChoose, chosen, children }: { kind: ReactNode; question: ReactNode; why?: ReactNode; choices?: { id: string; label: ReactNode; hint?: ReactNode }[]; onChoose?: (id: string) => void; chosen?: string; children?: ReactNode }) {
  return (
    <ThreadCard kind={kind} tone="agent" mark={<Sparkles aria-hidden size={14} />}>
      <p className="display text-[1.25rem] leading-tight">{question}</p>
      {why && <p className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-soft">{why}</p>}
      {choices && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {choices.map((c) => {
            const on = chosen === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                disabled={chosen !== undefined && !on}
                onClick={() => onChoose?.(c.id)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[0.92rem] font-semibold transition-colors duration-150 disabled:opacity-45 ${on ? "border-lavender-deep bg-lavender-deep text-paper" : "border-line-strong bg-paper text-ink hover:border-lavender-deep hover:bg-lavender"}`}
              >
                {on && <Check aria-hidden size={15} strokeWidth={2.6} />}
                {c.label}
                {c.hint && <span className={`font-normal ${on ? "text-paper/80" : "text-ink-soft"}`}>{c.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
      {children && <div className="mt-3.5">{children}</div>}
    </ThreadCard>
  );
}

export type ThreadOption = {
  id: string;
  rank: "best" | "better" | "good";
  name: ReactNode;
  detail?: ReactNode;
  price: ReactNode;
  per?: ReactNode;
  delivery?: ReactNode;
  keeps?: ReactNode[];
  givesUp?: ReactNode[];
  image?: ReactNode;
  disabled?: boolean;
  /** The agent would take this one; `why` says so in a line. */
  preselected?: ReactNode;
  /** Choosing it sends the order to a person: the reason, with the gate's mark. */
  signOff?: ReactNode;
};

/**
 * Options, ranked good, better, best, each saying what it keeps and what it gives up. The best one is marked by its
 * ring and its lime rank; the others are quiet. One choice, then the card settles on the chosen option.
 */
export function OptionsCard({ kind, intro, options, onChoose, chosen, note }: { kind: ReactNode; intro?: ReactNode; options: ThreadOption[]; onChoose?: (id: string) => void; chosen?: string; note?: ReactNode }) {
  const tx = useText(THREAD_TEXT);
  return (
    <ThreadCard kind={kind} mark={<ReceiptText aria-hidden size={14} />}>
      {intro && <p className="text-[0.95rem] leading-relaxed">{intro}</p>}
      <ul className={`grid gap-2.5 ${intro ? "mt-3" : ""}`}>
        {options.map((o) => {
          const on = chosen === o.id;
          const best = o.rank === "best";
          return (
            <li key={o.id} className={`rounded-lg border p-3.5 transition-[border-color,box-shadow,opacity] duration-150 ${on ? "border-petrol shadow-[0_0_0_1px_var(--color-petrol)]" : best && !chosen ? "border-petrol/50" : "border-line"} ${chosen && !on ? "opacity-55" : ""}`}>
              <div className="flex items-start gap-3">
                {o.image && <div className="size-14 shrink-0 overflow-hidden rounded-md bg-surface">{o.image}</div>}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`rounded-full px-2 text-[0.72rem] font-semibold leading-5 ${best ? "bg-lime text-ink" : "bg-surface text-ink-soft"}`}>{tx.rank[o.rank]}</span>
                    {o.delivery && <span className="text-[0.8rem] text-ink-soft">{o.delivery}</span>}
                  </p>
                  <p className="mt-1.5 font-semibold leading-snug">{o.name}</p>
                  {o.detail && <p className="text-[0.86rem] leading-snug text-ink-soft">{o.detail}</p>}
                </div>
                <p className="shrink-0 text-right">
                  <span className="display block text-[1.25rem] tabular">{o.price}</span>
                  {o.per && <span className="block text-[0.76rem] text-ink-soft">{o.per}</span>}
                </p>
              </div>
              {(o.keeps?.length || o.givesUp?.length) && (
                <ul className="mt-3 space-y-1 text-[0.86rem] leading-snug">
                  {o.keeps?.map((k, i) => (
                    <li key={`k${i}`} className="flex items-start gap-2">
                      <Check aria-hidden size={14} strokeWidth={2.6} className="mt-[0.2em] shrink-0 text-good" />
                      <span>
                        <span className="sr-only">{tx.keeps}: </span>
                        {k}
                      </span>
                    </li>
                  ))}
                  {o.givesUp?.map((g, i) => (
                    <li key={`g${i}`} className="flex items-start gap-2 text-ink-soft">
                      <Minus aria-hidden size={14} strokeWidth={2.6} className="mt-[0.2em] shrink-0 text-notice" />
                      <span>
                        <span className="sr-only">{tx.givesUp}: </span>
                        {g}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {o.preselected && !chosen && (
                <p className="mt-2.5 flex items-start gap-2 text-[0.84rem] leading-snug text-lavender-deep">
                  <Sparkles aria-hidden size={14} className="mt-[0.15em] shrink-0" />
                  {o.preselected}
                </p>
              )}
              {o.signOff && (
                <p className="mt-2.5 flex items-start gap-2 rounded-md bg-safety-soft px-2.5 py-1.5 text-[0.84rem] leading-snug">
                  <Target size={14} tone="safety" className="mt-[0.15em] shrink-0" />
                  {o.signOff}
                </p>
              )}
              {onChoose && (!chosen || on) && (
                <button
                  type="button"
                  disabled={o.disabled || on}
                  onClick={() => onChoose(o.id)}
                  className={`mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full text-[0.9rem] font-semibold transition-colors duration-150 pointer-coarse:min-h-11 ${on ? "bg-petrol-soft text-petrol-deep" : best ? "bg-lime text-ink hover:bg-lime-hover" : "border border-line-strong bg-paper text-ink hover:border-ink-soft hover:bg-mist"} disabled:cursor-default`}
                >
                  {on && <Check aria-hidden size={15} strokeWidth={2.6} />}
                  {on ? tx.chosen : tx.choose}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {note && <p className="mt-3 text-[0.82rem] leading-snug text-ink-soft">{note}</p>}
    </ThreadCard>
  );
}

/**
 * The fixed price: the figure, what it covers, how long it holds (`left` from 1 to 0 drains the bar), and that the
 * wholesaler signed it.
 */
export function PriceCard({ kind, price, per, lines, holds, left, signed, actions }: { kind: ReactNode; price: ReactNode; per?: ReactNode; lines?: { label: ReactNode; value: ReactNode }[]; holds?: ReactNode; left?: number; signed?: ReactNode; actions?: ReactNode }) {
  return (
    <ThreadCard kind={kind} mark={<Clock aria-hidden size={14} />} aside={holds} actions={actions}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="display text-[2.1rem] tabular">{price}</span>
        {per && <span className="text-[0.88rem] text-ink-soft">{per}</span>}
      </p>
      {left !== undefined && (
        <div aria-hidden className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface">
          <span className={`block h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none ${left < 0.2 ? "bg-notice" : "bg-petrol"}`} style={{ width: `${Math.max(0, Math.min(1, left)) * 100}%` }} />
        </div>
      )}
      {lines && (
        <dl className="mt-3 divide-y divide-line/70 text-[0.9rem]">
          {lines.map((l, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="min-w-0 text-ink-soft">{l.label}</dt>
              <dd className="shrink-0 font-medium tabular">{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {signed && (
        <p className="mt-3 flex items-start gap-2 text-[0.82rem] leading-snug text-ink-soft">
          <ShieldCheck aria-hidden size={15} className="mt-[0.1em] shrink-0 text-good" />
          {signed}
        </p>
      )}
    </ThreadCard>
  );
}

/** The contract's gate outcomes (web/docs/agent-thread.md), plus "checking" while the rules are being read. */
export type GateState = "checking" | "placed_alone" | "waiting" | "approved" | "refused" | "declined" | "withdrawn" | "expired";

/**
 * The gate: the signature moment. Plain code has checked the order against what the kitchen signed.
 *   checking      the rules are being read (a quiet card, the mark turning)
 *   placed_alone  inside the mandate: placed by the agent alone (quiet, good)
 *   waiting       beyond the mandate: the dark slab, the hazard band, who must sign and where it is waiting
 *   approved      the person signed: the slab settles to a stamp with their name
 *   refused       a rule refused it: the slab, the rule's name and its reason
 *   declined, withdrawn, expired   it ended without an order: quiet and plain, with who or why
 * Yellow, the hazard band and the gate's mark appear here and nowhere else in the thread.
 */
export function GateCard({ state, kind, title, reason, facts, rules, approver, countdown, actions }: { state: GateState; kind: ReactNode; title: ReactNode; reason?: ReactNode; facts?: { label: ReactNode; value: ReactNode }[]; rules?: { title: ReactNode; ok: boolean }[]; approver?: { name: string; role?: ReactNode; where?: ReactNode }; countdown?: ReactNode; actions?: ReactNode }) {
  const tx = useText(THREAD_TEXT);
  const passedRules = rules?.filter((r) => r.ok).length ?? 0;
  const failed = rules?.filter((r) => !r.ok) ?? [];
  if (state !== "waiting" && state !== "refused") {
    const good = state === "placed_alone" || state === "approved";
    return (
      <ThreadCard
        kind={kind}
        tone={good ? "good" : "plain"}
        mark={state === "checking" ? <Target size={15} tone="hollow" spin /> : good ? <ShieldCheck aria-hidden size={15} /> : <Target size={15} tone="ink" />}
        aside={rules && good ? tx.passed(passedRules) : undefined}
        actions={actions}
      >
        <p className="display text-[1.3rem] leading-tight">{title}</p>
        {reason && <p className="mt-1.5 text-[0.93rem] leading-relaxed text-ink-soft">{reason}</p>}
        {state === "approved" && approver && (
          <p className="stamp mt-3.5 inline-flex items-center gap-2.5 rounded-full border border-good/30 bg-good-soft py-1 pl-1 pr-3.5 text-[0.9rem] font-semibold text-good">
            <Avatar name={approver.name} size={28} className="!bg-good !text-paper" />
            {approver.name}
            {approver.role && <span className="font-normal">{approver.role}</span>}
          </p>
        )}
        {facts && <Facts facts={facts} />}
      </ThreadCard>
    );
  }
  return (
    <article className="hazard-frame on-dark text-paper">
      <header className="flex items-center gap-2.5 px-4 pt-3.5">
        <Target size={22} tone="safety" />
        <p className="min-w-0 flex-1 truncate text-[0.82rem] font-medium text-paper/70">{kind}</p>
        {countdown && <span className="shrink-0 rounded-full bg-paper/10 px-2.5 text-[0.8rem] font-semibold leading-6 text-safety tabular">{countdown}</span>}
      </header>
      <div className="px-4 pb-4 pt-2.5">
        <p className="display text-[1.45rem] leading-tight text-safety">{title}</p>
        {reason && <p className="mt-1.5 text-[0.95rem] leading-relaxed text-paper/90">{reason}</p>}
        {failed.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[0.9rem]">
            {failed.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <X aria-hidden size={15} strokeWidth={2.6} className="mt-[0.15em] shrink-0 text-safety" />
                <span>{r.title}</span>
              </li>
            ))}
          </ul>
        )}
        {state === "waiting" && approver && (
          <div className="mt-3.5 flex items-center gap-3 rounded-lg bg-paper/8 p-3">
            <span className="relative shrink-0">
              <Avatar name={approver.name} size={40} tone="dark" />
              <span aria-hidden className="breathe absolute -right-0.5 -top-0.5 size-3 rounded-full bg-safety ring-2 ring-safety-ink" />
            </span>
            <p className="min-w-0 leading-snug">
              <span className="block font-semibold">
                {approver.name}
                {approver.role && <span className="font-normal text-paper/70">, {approver.role}</span>}
              </span>
              {approver.where && <span className="block text-[0.86rem] text-paper/70">{approver.where}</span>}
            </p>
          </div>
        )}
        {facts && <Facts facts={facts} dark />}
        {rules && passedRules > 0 && <p className="mt-3 text-[0.8rem] text-paper/60">{tx.passed(passedRules)}</p>}
      </div>
      {actions && <footer className="flex flex-wrap items-center gap-2.5 border-t border-paper/12 px-4 py-3">{actions}</footer>}
    </article>
  );
}

function Facts({ facts, dark = false }: { facts: { label: ReactNode; value: ReactNode }[]; dark?: boolean }) {
  return (
    <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
      {facts.map((f, i) => (
        <div key={i} className="min-w-0">
          <dt className={`text-[0.76rem] ${dark ? "text-paper/60" : "text-ink-soft"}`}>{f.label}</dt>
          <dd className="mt-0.5 text-[0.98rem] font-semibold leading-snug tabular">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The order: what was bought, for when, for how much, and where it stands. */
export function OrderCard({ kind, status, lines, total, totalLabel, delivery, href, linkLabel, actions }: { kind: ReactNode; status?: { label: ReactNode; tone: "good" | "waiting" | "refused" | "neutral" }; lines: { name: ReactNode; qty: ReactNode; price?: ReactNode }[]; total: ReactNode; totalLabel: ReactNode; delivery?: ReactNode; href?: string; linkLabel?: ReactNode; actions?: ReactNode }) {
  return (
    <ThreadCard kind={kind} tone={status?.tone === "good" ? "good" : "plain"} mark={<ReceiptText aria-hidden size={14} />} aside={status && <Badge tone={status.tone}>{status.label}</Badge>} actions={actions}>
      <ul className="divide-y divide-line/70 text-[0.92rem]">
        {lines.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-1.5 first:pt-0">
            <span className="min-w-0">
              <span className="font-medium">{l.name}</span>
              <span className="ml-2 text-ink-soft tabular">{l.qty}</span>
            </span>
            {l.price && <span className="shrink-0 tabular">{l.price}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-2.5">
        <span className="text-[0.86rem] text-ink-soft">{totalLabel}</span>
        <span className="display text-[1.5rem] tabular">{total}</span>
      </p>
      {(delivery || href) && (
        <p className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[0.86rem] text-ink-soft">
          {delivery && <span>{delivery}</span>}
          {href && (
            <Link href={href} className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
              {linkLabel}
            </Link>
          )}
        </p>
      )}
    </ThreadCard>
  );
}

/**
 * Memory, the lavender card: what memory answered instead of asking, or, after an order, what the agent proposes to
 * remember. A proposal has keep and drop on its line; once answered the line shows which.
 */
export function MemoryCard({ kind, items, actions }: { kind: ReactNode; items: { key?: string; text: ReactNode; source?: ReactNode; state?: "kept" | "dropped"; onKeep?: () => void; onDrop?: () => void; keepLabel?: string; dropLabel?: string }[]; actions?: ReactNode }) {
  return (
    <article className="rounded-xl bg-lavender-mid/55 px-4 py-3.5">
      <p className="flex items-center gap-2 text-[0.82rem] font-medium text-lavender-deep">
        <Sparkles aria-hidden size={14} />
        {kind}
      </p>
      <ul className="mt-2 space-y-2 text-[0.93rem] leading-snug">
        {items.map((it, i) => (
          <li key={it.key ?? i} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${it.state === "dropped" ? "text-ink-soft line-through decoration-1" : ""}`}>
            <span className="min-w-0 flex-1">
              {it.text}
              {it.source && <span className="ml-1.5 text-[0.8rem] text-lavender-deep/80">{it.source}</span>}
            </span>
            {it.state === "kept" && <Check aria-hidden size={16} strokeWidth={2.6} className="shrink-0 text-lavender-deep" />}
            {!it.state && (it.onKeep || it.onDrop) && (
              <span className="flex shrink-0 gap-1.5">
                {it.onKeep && (
                  <button type="button" onClick={it.onKeep} className="inline-flex min-h-9 items-center rounded-full bg-lavender-deep px-3.5 text-[0.84rem] font-semibold text-paper pointer-coarse:min-h-11">
                    {it.keepLabel}
                  </button>
                )}
                {it.onDrop && (
                  <button type="button" onClick={it.onDrop} className="inline-flex min-h-9 items-center rounded-full px-3 text-[0.84rem] font-medium text-lavender-deep hover:bg-lavender pointer-coarse:min-h-11">
                    {it.dropLabel}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {actions && <div className="mt-2.5 flex flex-wrap gap-2.5">{actions}</div>}
    </article>
  );
}

/** Records: the answer to "what did we order last week?", as rows from the kitchen's own records, each with its source. */
export function RecordsCard({ kind, rows, note }: { kind: ReactNode; rows: { label: ReactNode; value?: ReactNode; sub?: ReactNode; href?: string }[]; note?: ReactNode }) {
  return (
    <ThreadCard kind={kind} mark={<ReceiptText aria-hidden size={14} />}>
      <ul className="divide-y divide-line/70 text-[0.92rem]">
        {rows.map((r, i) => {
          const inner = (
            <>
              <span className="min-w-0">
                <span className="block font-medium leading-snug">{r.label}</span>
                {r.sub && <span className="block text-[0.82rem] text-ink-soft">{r.sub}</span>}
              </span>
              {r.value && <span className="shrink-0 font-medium tabular">{r.value}</span>}
            </>
          );
          return (
            <li key={i}>
              {r.href ? (
                <Link href={r.href} className="-mx-2 flex items-baseline justify-between gap-4 rounded-md px-2 py-2 transition-colors hover:bg-mist">
                  {inner}
                </Link>
              ) : (
                <div className="flex items-baseline justify-between gap-4 py-2">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {note && <p className="mt-2.5 text-[0.8rem] leading-snug text-ink-soft">{note}</p>}
    </ThreadCard>
  );
}

/**
 * A notice: the agent could not do it, in plain words and with what to do next (not found, not a purchase, something
 * missing, the model is unavailable). Calm and plain. `gate` is for a suspension: an operator stopped the agent.
 */
export function NoticeCard({ kind, title, children, tone = "plain", actions }: { kind: ReactNode; title: ReactNode; children?: ReactNode; tone?: "plain" | "gate"; actions?: ReactNode }) {
  if (tone === "gate")
    return (
      <article className="rounded-xl bg-safety-soft px-4 py-3.5 ring-1 ring-inset ring-safety/60">
        <p className="flex items-center gap-2 text-[0.82rem] font-medium">
          <Target size={15} tone="safety" />
          {kind}
        </p>
        <p className="mt-1.5 font-semibold leading-snug">{title}</p>
        {children && <div className="mt-1 text-[0.92rem] leading-relaxed text-ink-soft">{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2.5">{actions}</div>}
      </article>
    );
  return (
    <ThreadCard kind={kind} mark={<CircleAlert aria-hidden size={15} />} actions={actions} className="!border-line-strong !bg-mist">
      <p className="font-semibold leading-snug">{title}</p>
      {children && <div className="mt-1 text-[0.92rem] leading-relaxed text-ink-soft">{children}</div>}
    </ThreadCard>
  );
}

/** A card that has been answered says how, where its actions were. */
function Answered({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
      <Check aria-hidden size={14} strokeWidth={2.6} className="text-good" />
      {children}
    </span>
  );
}

// ---------- the composer ----------

export type MicState = "idle" | "listening" | "processing" | "off";

/**
 * The one place the buyer speaks to the agent: a field, a microphone (hold to talk), a photo, send.
 *   idle        the field, with the tools on its right
 *   listening   the field gives way to what is being heard and a moving level; release sends
 *   processing  the words are being read; the field is back, disabled
 * `tools` replaces the built-in microphone and photo buttons when a page brings its own.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  busy = false,
  disabled = false,
  mic,
  onPhoto,
  tools,
  size = "md",
  inputRef,
  id = "need",
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  mic?: { state: MicState; onDown: () => void; onUp: () => void; heard?: ReactNode };
  onPhoto?: () => void;
  tools?: ReactNode;
  size?: "md" | "lg";
  inputRef?: React.Ref<HTMLInputElement>;
  id?: string;
  hint?: ReactNode;
}) {
  const tx = useText(THREAD_TEXT);
  const listening = mic?.state === "listening";
  const tall = size === "lg";
  const tool = "flex shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors duration-150 hover:bg-surface hover:text-ink disabled:opacity-40 " + (tall ? "size-12" : "size-11");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className={`flex items-center gap-0.5 rounded-[1.75rem] bg-paper p-1 shadow-sm ring-1 transition-shadow duration-150 ${listening ? "ring-2 ring-lavender-deep" : "ring-line-strong focus-within:ring-2 focus-within:ring-lavender-deep"}`}>
        {listening ? (
          <p className={`flex min-w-0 flex-1 items-center gap-3 px-3 ${tall ? "min-h-13" : "min-h-11"}`} role="status">
            <VoiceBars />
            <span className="min-w-0 truncate text-[1rem] text-ink">{mic?.heard || <span className="text-ink-soft">{tx.release}</span>}</span>
          </p>
        ) : (
          <input
            id={id}
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            enterKeyHint="send"
            disabled={disabled || mic?.state === "processing"}
            className={`min-w-0 flex-1 rounded-full bg-transparent pl-4 pr-1 placeholder:text-ink-soft focus:outline-none focus-visible:outline-none disabled:text-ink-soft ${tall ? "min-h-12 text-[0.95rem] sm:min-h-13 sm:text-[1.08rem]" : "min-h-11 text-[1rem]"}`}
          />
        )}
        {tools ?? (
          <>
            {mic && mic.state !== "off" && (
              <button
                type="button"
                aria-label={tx.talk}
                title={tx.talk}
                aria-pressed={listening}
                disabled={disabled}
                onPointerDown={(e) => {
                  e.preventDefault();
                  mic.onDown();
                }}
                onPointerUp={mic.onUp}
                onPointerLeave={() => listening && mic.onUp()}
                onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && mic.onDown()}
                onKeyUp={(e) => (e.key === " " || e.key === "Enter") && mic.onUp()}
                className={listening ? `${tool} relative !bg-lavender-deep !text-paper` : tool}
              >
                {listening && <span aria-hidden className="voice-ring absolute inset-0 rounded-full bg-lavender-deep" />}
                {mic.state === "processing" ? <Spinner size={18} /> : <Mic aria-hidden size={tall ? 22 : 20} className="relative" />}
              </button>
            )}
            {onPhoto && !listening && (
              <button type="button" aria-label={tx.photo} title={tx.photo} disabled={disabled} onClick={onPhoto} className={tool}>
                <Camera aria-hidden size={tall ? 22 : 20} />
              </button>
            )}
          </>
        )}
        {!listening && (
          <button type="submit" disabled={disabled || busy} aria-busy={busy || undefined} aria-label={tx.send} title={tx.send} className={`flex shrink-0 items-center justify-center rounded-full bg-lime text-ink transition-[background-color,transform] duration-150 hover:bg-lime-hover active:scale-95 disabled:opacity-60 motion-reduce:active:scale-100 ${tall ? "size-12 sm:size-13" : "size-11"}`}>
            {busy ? <Spinner size={18} /> : <ArrowUp aria-hidden size={tall ? 24 : 21} strokeWidth={2.4} />}
          </button>
        )}
      </div>
      {hint && <p className="mt-2 px-2 text-[0.78rem] leading-snug text-ink-soft">{hint}</p>}
    </form>
  );
}

// ---------- voice ----------

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "waiting" | "reconnecting";

/** Five bars that move while someone is being heard, or while the agent speaks. */
export function VoiceBars({ className = "", calm = false }: { className?: string; calm?: boolean }) {
  return (
    <span aria-hidden className={`inline-flex h-5 shrink-0 items-center gap-[3px] ${className}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`voice-bar w-[3px] rounded-full bg-current ${calm ? "voice-bar-calm" : ""}`} style={{ animationDelay: `${i * 110}ms`, height: `${[45, 80, 100, 65, 40][i]}%` }} />
      ))}
    </span>
  );
}

/**
 * The call's state, small (a pill for the thread's header or the composer) or large (the call screen's centre).
 *   listening     the buyer is being heard: bars, lavender
 *   thinking      the agent is working: three slow dots
 *   speaking      the agent is talking: bars, calmer
 *   waiting       a sign-off is needed: the gate's mark and yellow (the only state that borrows from the gate)
 *   reconnecting  the line dropped: a turning ring, quiet
 *   idle          ready: a still dot
 * `label` overrides the kit's own word for the state.
 */
export function VoiceStatus({ state, label, size = "sm" }: { state: VoiceState; label?: ReactNode; size?: "sm" | "lg" }) {
  const tx = useText(THREAD_TEXT);
  const word = label ?? tx.voice[state];
  const mark =
    state === "listening" ? (
      <VoiceBars />
    ) : state === "speaking" ? (
      <VoiceBars calm />
    ) : state === "thinking" ? (
      <span aria-hidden className="inline-flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="voice-dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${i * 180}ms` }} />
        ))}
      </span>
    ) : state === "waiting" ? (
      <Target size={size === "lg" ? 44 : 16} tone="safety" />
    ) : state === "reconnecting" ? (
      <Spinner size={size === "lg" ? 32 : 14} />
    ) : (
      <span aria-hidden className="size-2 rounded-full bg-current" />
    );
  if (size === "sm") {
    const look = state === "waiting" ? "bg-safety-soft text-safety-ink ring-1 ring-inset ring-safety/60" : state === "reconnecting" || state === "idle" ? "bg-surface text-ink-soft" : "bg-lavender-deep text-paper";
    return (
      <span role="status" className={`inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-[0.82rem] font-semibold ${look}`}>
        {mark}
        {word}
      </span>
    );
  }
  const ground = state === "waiting" ? "bg-safety-ink text-safety" : state === "reconnecting" || state === "idle" ? "bg-surface text-ink-soft" : "bg-lavender-deep text-paper";
  const live = state === "listening" || state === "speaking";
  return (
    <div role="status" className="flex flex-col items-center gap-4 text-center">
      <span className="relative flex size-36 items-center justify-center">
        {live && <span aria-hidden className="voice-ring absolute inset-0 rounded-full bg-lavender-deep" />}
        {live && <span aria-hidden className="voice-ring absolute inset-0 rounded-full bg-lavender-deep" style={{ animationDelay: "700ms" }} />}
        <span className={`relative flex size-28 items-center justify-center rounded-full shadow-md ${ground} [&_.voice-bar]:w-1.5 [&>span]:h-10 [&>span]:gap-1.5`}>{mark}</span>
      </span>
      <p className="display text-[1.5rem]">{word}</p>
    </div>
  );
}
