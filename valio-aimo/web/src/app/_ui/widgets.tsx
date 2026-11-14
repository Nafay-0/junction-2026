"use client";

import { ArrowLeftRight, Check, ChevronDown, CircleAlert, CircleHelp, Minus, Package, Plus, ReceiptText, Sparkles, Trash2, UtensilsCrossed, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useText } from "../_i18n/provider";
import { Art, hasArt } from "./art";
import { Spinner, Switch, buttonClass } from "./kit";
import { Target } from "./target";
import { StepLines, ThreadCard, type Step } from "./thread";
import { WIDGET_TEXT } from "./widgets.text";

/**
 * The thread's widgets: the places where a buyer refines an order or a menu without leaving the conversation and
 * without typing (web/docs/DESIGN.md, "Widgets"). The agent's cards say what happened; a widget is something the
 * buyer works on. Every change a widget reports goes back to the same engine and the same gate as a typed turn.
 *
 * All of them are presentational and take plain data: strings already formatted for the buyer's language (amounts,
 * prices, days), ids to report back, and callbacks. Nothing here computes a price, a date or a verdict.
 *
 * They belong to the card family (ThreadCard's anatomy, radius and hairline) and work at three widths: a phone
 * (390 px), the docked column, and the workspace's working surface.
 */

// ---------- shared pieces ----------

/** A product's illustration in a small rounded box, or a quiet glyph when there is none. */
export function Thumb({ art, className = "size-14" }: { art?: string; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface text-ink-soft ${className}`}>
      {hasArt(art) ? <Art k={art} sizes="8rem" cover className="size-full" imgClassName="size-full object-cover" /> : <Package aria-hidden size={20} />}
    </span>
  );
}

/**
 * A stepper for whole things (packs, covers). The middle is a number field, so a large change is one edit and not
 * forty taps; the buttons are 44 px targets. `children` sits beside it: what the number means in litres or kilos.
 */
export function Stepper({ value, onChange, min = 0, max, step = 1, less, more, label, disabled, children, size = "md" }: { value: number; onChange: (next: number) => void; min?: number; max?: number; step?: number; less: string; more: string; label: string; disabled?: boolean; children?: ReactNode; size?: "md" | "lg" }) {
  const clamp = (n: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, n));
  // A typed number is a draft until the field is left or Enter is pressed: typing "200" is one change, not "2", "20",
  // "200", and an emptied field does not jump to the minimum under the cook's thumb. Enter only commits the number:
  // it never submits anything (only a widget's own confirm button orders).
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const commit = () => {
    if (draft === undefined) return;
    const n = Number(draft.replace(/[^\d]/g, ""));
    setDraft(undefined);
    if (draft.trim() !== "" && Number.isFinite(n) && clamp(n) !== value) onChange(clamp(n));
  };
  const side = `flex shrink-0 items-center justify-center text-ink transition-colors duration-150 hover:bg-petrol-soft disabled:cursor-not-allowed disabled:text-line-strong disabled:hover:bg-transparent ${size === "lg" ? "size-12" : "size-11"}`;
  return (
    <span className="inline-flex items-center gap-3">
      <span className={`inline-flex items-stretch overflow-hidden rounded-full border bg-paper ${disabled ? "border-line" : "border-line-strong"}`}>
        <button type="button" aria-label={less} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} className={side}>
          <Minus aria-hidden size={17} strokeWidth={2.4} />
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          enterKeyHint="done"
          disabled={disabled}
          value={draft ?? String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(undefined);
              e.currentTarget.blur();
            }
          }}
          className={`tabular min-w-0 border-x border-line bg-transparent text-center font-semibold outline-none focus-visible:bg-petrol-soft disabled:text-ink-soft ${size === "lg" ? "w-[4.5rem] text-[1.15rem]" : "w-16 text-[1rem]"}`}
        />
        <button type="button" aria-label={more} disabled={disabled || (max !== undefined && value >= max)} onClick={() => onChange(clamp(value + step))} className={side}>
          <Plus aria-hidden size={17} strokeWidth={2.4} />
        </button>
      </span>
      {children && <span className="text-[0.9rem] leading-tight text-ink-soft tabular">{children}</span>}
    </span>
  );
}

export type DayChoice = {
  /** What comes back in `onDay`: the engine's own id for the day (an ISO date). */
  id: string;
  /** "Mon", already in the buyer's language. */
  weekday: string;
  /** "16.11." */
  date: string;
  /** "Sun 17.00": the order-by time for this day. */
  orderBy?: string;
  possible: boolean;
  /** Why not, in a few words: "cut-off passed", "no delivery on Sundays". */
  reason?: string;
};

/**
 * The days that are really possible, as a short row: each says its order-by time. A day that is not possible stays
 * in the row, dimmed, with its reason, because the missing day is usually the one the buyer wanted.
 */
export function DayRow({ days, day, onDay, label, disabled }: { days: DayChoice[]; day?: string; onDay: (id: string) => void; label: string; disabled?: boolean }) {
  const tx = useText(WIDGET_TEXT);
  return (
    <div role="radiogroup" aria-label={label} className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
      {days.map((d) => {
        const on = d.id === day;
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={!d.possible || undefined}
            disabled={disabled}
            onClick={() => d.possible && onDay(d.id)}
            className={`flex min-h-[3.25rem] min-w-[6.75rem] shrink-0 snap-start flex-col justify-center rounded-lg border px-3 py-1.5 text-left transition-[background-color,border-color,color] duration-150 ${
              on ? "border-petrol bg-petrol text-paper" : d.possible ? "border-line-strong bg-paper hover:border-petrol hover:bg-petrol-soft" : "cursor-not-allowed border-dashed border-line bg-transparent text-ink-soft"
            }`}
          >
            <span className={`text-[0.95rem] font-semibold leading-tight tabular ${!d.possible ? "line-through decoration-ink-soft/50" : ""}`}>
              {d.weekday} {d.date}
            </span>
            <span className={`text-[0.74rem] leading-tight tabular ${on ? "text-paper/80" : "text-ink-soft"}`}>{d.possible ? (d.orderBy ? tx.sheet.orderBy(d.orderBy) : " ") : d.reason}</span>
          </button>
        );
      })}
    </div>
  );
}

export type Outcome = {
  /** What the gate's own preview says will happen if the buyer confirms now. */
  kind: "alone" | "sign" | "blocked";
  /** The sentence for it: "Inside the 500 € the agent may spend alone", "Aino Virtanen signs: over the 500 € limit". */
  text: string;
  detail?: string;
};

/** One line that always says what will happen on confirm. Never more than one: it is the sheet's verdict. */
export function OutcomeLine({ outcome }: { outcome: Outcome }) {
  const tx = useText(WIDGET_TEXT);
  const look = outcome.kind === "alone" ? "bg-good-soft text-good" : outcome.kind === "sign" ? "bg-safety-soft text-ink" : "bg-notice-soft text-notice";
  return (
    <p role="status" className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[0.9rem] leading-snug ${look}`}>
      <span className="mt-[0.1em] shrink-0">{outcome.kind === "alone" ? <Check aria-hidden size={16} strokeWidth={2.6} /> : outcome.kind === "sign" ? <Target size={16} tone="safety" /> : <CircleAlert aria-hidden size={16} />}</span>
      <span>
        <span className="font-semibold">{tx.sheet.outcome[outcome.kind]}.</span> <span className={outcome.kind === "alone" ? "text-ink" : ""}>{outcome.text}</span>
        {outcome.detail && <span className="mt-0.5 block text-[0.84rem] text-ink-soft">{outcome.detail}</span>}
      </span>
    </p>
  );
}

const quietAction = "inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[0.86rem] font-medium text-petrol transition-colors duration-150 hover:bg-petrol-soft pointer-coarse:min-h-11";

// ---------- the order sheet ----------

export type SheetLine = {
  id: string;
  name: string;
  /** "1 l carton", "10 l bag-in-box". */
  pack: string;
  /** Key of the product's illustration (see art.tsx). */
  art?: string;
  packs: number;
  minPacks?: number;
  maxPacks?: number;
  /** What the packs come to: "1 000 L", "12,5 kg". */
  amount: string;
  /** "1,01 €/l". */
  unitPrice?: string;
  /** The line's total, formatted. */
  total: string;
  state?: "ok" | "updating" | "unavailable";
  /** Why it became unavailable. */
  reason?: string;
  /** The product this one replaced, when the buyer or the agent swapped it. */
  swappedFrom?: string;
  /** Packs per tap of the stepper: 1 for big packs, more for small ones (ten 1 L cartons at a time). The number can be typed. */
  step?: number;
  /** The kitchen's usual amounts for this product, one tap each: packs, and what they come to ("100 L"). */
  quick?: { packs: number; label: string }[];
};

export type SheetNotice = { key: string; text: string; action?: { label: string; onClick: () => void } };

/**
 * The order being built. By default it is one clear card: what, how much, which day, the total, what will happen,
 * and one button that says exactly that. Nothing else is in the way. "Change" opens the editing controls in place:
 * amounts in whole packs, the delivery day among the days that are possible, swap, remove, add.
 *
 * Under the lines it always says what will happen on confirm (`outcome`, from the same check the order goes
 * through), and the button's words match it. The button is the only thing that orders: Enter in an amount field,
 * a swipe or a tap on a line never does.
 *
 * States: `busy` (recalculating: the totals shimmer, the button waits), a line `unavailable` (the sheet opens for
 * editing and asks for a swap), `notices` (over the week's budget with the amount that fits, a duplicate of a recent
 * order), `removed` (one tap undoes it), `settled` (sent: read-only, with "take it back" while that is possible).
 */
export function OrderSheet({ kind, lines, onPacks, onSwap, onRemove, onAdd, days, day, onDay, total, totalNote, outcome, notices, confirm, onConfirm, busy, settled, settledNote, takeBack, removed, defaultEditing = false }: {
  kind: ReactNode;
  lines: SheetLine[];
  onPacks: (id: string, packs: number) => void;
  onSwap?: (id: string) => void;
  onRemove?: (id: string) => void;
  onAdd?: () => void;
  days: DayChoice[];
  day?: string;
  onDay: (id: string) => void;
  total: string;
  totalNote?: string;
  outcome: Outcome;
  notices?: SheetNotice[];
  /** The button's words, matching the outcome, with the price: "Order this, 404,00 €", "Send to Aino for an OK, 1 010,00 €". */
  confirm: string;
  onConfirm: () => void;
  busy?: boolean;
  settled?: boolean;
  /** What happened, once sent: "Ordered. Arrives Mon 16.11.", "Waiting for Aino's OK". */
  settledNote?: string;
  /** Shown once sent, for as long as the order can still be taken back: "Take it back (until Sun 17.00)". */
  takeBack?: { label: string; onClick: () => void };
  /** A line was just removed: its name, and the one tap that brings it back. */
  removed?: { name: string; onUndo: () => void };
  defaultEditing?: boolean;
}) {
  const tx = useText(WIDGET_TEXT);
  const stuck = lines.some((l) => l.state === "unavailable");
  const [wantsEdit, setEditing] = useState(defaultEditing);
  const editing = !settled && (wantsEdit || stuck);
  const chosenDay = days.find((d) => d.id === day);
  return (
    <ThreadCard kind={kind} mark={<ReceiptText aria-hidden size={14} />} aside={busy ? <span className="inline-flex items-center gap-1.5"><Spinner size={13} />{tx.sheet.updating}</span> : undefined}>
      <ul className="divide-y divide-line">
        {lines.map((l) => {
          const gone = l.state === "unavailable";
          return (
            <li key={l.id} className="py-3 first:pt-1">
              <div className="flex items-start gap-3">
                <Thumb art={l.art} className={`size-12 ${gone ? "opacity-50 grayscale" : ""}`} />
                <div className="min-w-0 flex-1">
                  <p className={`font-semibold leading-snug [overflow-wrap:anywhere] ${gone ? "text-ink-soft line-through decoration-ink-soft/50" : ""}`}>{l.name}</p>
                  <p className="mt-0.5 text-[0.84rem] leading-snug text-ink-soft tabular">
                    {editing ? l.pack : `${l.packs.toLocaleString("fi-FI")} × ${l.pack} = ${l.amount}`}
                    {editing && l.unitPrice && <span> · {l.unitPrice}</span>}
                  </p>
                  {l.swappedFrom && (
                    <p className="mt-1 flex items-start gap-1.5 text-[0.82rem] leading-snug text-lavender-deep">
                      <ArrowLeftRight aria-hidden size={13} className="mt-[0.2em] shrink-0" />
                      {tx.sheet.swappedFrom(l.swappedFrom)}
                    </p>
                  )}
                </div>
                {editing && onRemove ? (
                  <button type="button" aria-label={`${tx.sheet.remove}: ${l.name}`} onClick={() => onRemove(l.id)} className="-mr-2 -mt-1.5 flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface hover:text-ink">
                    <Trash2 aria-hidden size={17} />
                  </button>
                ) : (
                  !editing && !gone && (l.state === "updating" ? <span aria-label={tx.sheet.updating} className="skeleton block h-5 w-20 shrink-0" /> : <p className="shrink-0 text-right font-semibold tabular">{l.total}</p>)
                )}
              </div>
              {gone && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-notice-soft px-3 py-2">
                  <p className="min-w-0 flex-1 text-[0.88rem] leading-snug">
                    <span className="font-semibold text-notice">{tx.sheet.unavailable}.</span> {l.reason}
                  </p>
                  {onSwap && (
                    <button type="button" onClick={() => onSwap(l.id)} className={buttonClass("primary", "sm")}>
                      <ArrowLeftRight aria-hidden size={15} />
                      {tx.sheet.swap}
                    </button>
                  )}
                </div>
              )}
              {editing && !gone && (
                <>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Stepper value={l.packs} min={l.minPacks ?? 1} max={l.maxPacks} step={l.step ?? 1} onChange={(n) => onPacks(l.id, n)} less={(l.step ?? 1) > 1 ? tx.sheet.lessN(l.step!) : tx.sheet.less} more={(l.step ?? 1) > 1 ? tx.sheet.moreN(l.step!) : tx.sheet.more} label={`${tx.sheet.packs}: ${l.name}`}>
                      = {l.amount}
                    </Stepper>
                    {l.state === "updating" ? <span aria-label={tx.sheet.updating} className="skeleton block h-6 w-20 shrink-0" /> : <span className="shrink-0 text-right font-semibold tabular">{l.total}</span>}
                  </div>
                  {l.quick && l.quick.length > 0 && (
                    <div role="group" aria-label={`${tx.sheet.usual}: ${l.name}`} className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[0.8rem] text-ink-soft">{tx.sheet.usual}</span>
                      {l.quick.map((q) => (
                        <button key={q.packs} type="button" aria-pressed={q.packs === l.packs} onClick={() => onPacks(l.id, q.packs)} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-[0.84rem] font-medium tabular transition-colors duration-150 pointer-coarse:min-h-11 ${q.packs === l.packs ? "border-petrol bg-petrol text-paper" : "border-line-strong bg-paper text-ink hover:border-petrol hover:bg-petrol-soft"}`}>
                          {q.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {onSwap && (
                    <button type="button" onClick={() => onSwap(l.id)} className={`${quietAction} -ml-2.5 mt-1.5`}>
                      <ArrowLeftRight aria-hidden size={15} />
                      {tx.sheet.swapFor}
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {removed && !settled && (
        <p className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-1.5 text-[0.88rem] leading-snug">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{tx.sheet.removed(removed.name)}</span>
          <button type="button" onClick={removed.onUndo} className={`${quietAction} shrink-0 font-semibold`}>
            {tx.sheet.undo}
          </button>
        </p>
      )}

      {editing && onAdd && (
        <button type="button" onClick={onAdd} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-[0.9rem] font-medium text-petrol transition-colors duration-150 hover:border-petrol hover:bg-petrol-soft">
          <Plus aria-hidden size={16} />
          {tx.sheet.add}
        </button>
      )}

      {editing ? (
        <div className="mt-4">
          <p className="mb-2 text-[0.82rem] font-medium text-ink-soft">{tx.sheet.day}</p>
          <DayRow days={days} day={day} onDay={onDay} label={tx.sheet.day} />
        </div>
      ) : (
        chosenDay && (
          <p className="flex items-baseline justify-between gap-3 border-t border-line pt-3 text-[0.92rem] leading-snug">
            <span className="text-ink-soft">{tx.sheet.delivery}</span>
            <span className="text-right tabular">
              <span className="font-semibold">
                {chosenDay.weekday} {chosenDay.date}
              </span>
              {chosenDay.orderBy && !settled && <span className="text-ink-soft">, {tx.sheet.orderBy(chosenDay.orderBy)}</span>}
            </span>
          </p>
        )
      )}

      <div className={`flex items-end justify-between gap-3 border-t border-line pt-3 ${editing ? "mt-4" : "mt-3"}`}>
        <p>
          <span className="block text-[0.82rem] font-medium text-ink-soft">{tx.sheet.total}</span>
          {totalNote && <span className="block text-[0.8rem] text-ink-soft tabular">{totalNote}</span>}
        </p>
        {busy ? <span aria-label={tx.sheet.updating} className="skeleton block h-8 w-32" /> : <p className="display text-[1.7rem] leading-none tabular">{total}</p>}
      </div>

      {!settled &&
        notices?.map((n) => (
          <div key={n.key} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-notice/25 bg-notice-soft px-3 py-2.5">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-[0.88rem] leading-snug text-notice">
              <CircleAlert aria-hidden size={15} className="mt-[0.15em] shrink-0" />
              <span className="text-ink">{n.text}</span>
            </p>
            {n.action && (
              <button type="button" onClick={n.action.onClick} className={buttonClass("secondary", "sm")}>
                {n.action.label}
              </button>
            )}
          </div>
        ))}

      {settled ? (
        <div className="mt-3 rounded-lg bg-petrol-soft px-3 py-2.5">
          <p className="flex items-start gap-2 text-[0.92rem] font-semibold leading-snug text-petrol-deep">
            <Check aria-hidden size={16} strokeWidth={2.6} className="mt-[0.15em] shrink-0" />
            {settledNote ?? tx.sheet.settled}
          </p>
          {takeBack && (
            <button type="button" onClick={takeBack.onClick} className={`${buttonClass("secondary", "sm")} mt-2.5`}>
              {takeBack.label}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3">
            <OutcomeLine outcome={outcome} />
          </div>
          <button type="button" disabled={busy || stuck || outcome.kind === "blocked"} onClick={onConfirm} className={`${buttonClass("go", "lg")} mt-3 w-full disabled:cursor-not-allowed disabled:opacity-55`}>
            {busy && <Spinner size={16} />}
            <span className="tabular">{confirm}</span>
          </button>
          <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)} disabled={stuck} className="mt-1.5 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full text-[0.9rem] font-medium text-petrol transition-colors duration-150 hover:bg-petrol-soft disabled:hidden">
            {editing ? tx.sheet.done : tx.sheet.change}
          </button>
        </>
      )}
    </ThreadCard>
  );
}

// ---------- the alternatives picker ----------

export type PickerRow = { key: string; label: string };

/** One fact about one candidate. `tone` is against the candidate being replaced: the page decides, the kit colours. */
export type PickerCell = { text: string; tone?: "same" | "better" | "worse" | "plain" };

export type Candidate = {
  id: string;
  name: string;
  pack: string;
  art?: string;
  /** The total for the amount on the order sheet, formatted. */
  price: string;
  /** "1,01 €/l". */
  per?: string;
  /** The one line that matters most about this candidate: "As your usual", "550 € more", "UHT, keeps longer". */
  headline: string;
  badge?: "current" | "usual" | "asked";
  /** Choosing it would need a person's signature: the reason. A candidate the gate would refuse is never passed in. */
  signOff?: string;
  /** Keyed by the rows' keys. A missing cell renders as a dash, so the rows stay aligned. */
  cells: Record<string, PickerCell>;
};

/**
 * Comparing, not reading: two to four candidates side by side, their facts aligned row by row so the eye runs
 * across. On a phone the columns snap sideways with the next one peeking; in the workspace they sit in columns.
 * The chips re-rank or filter in place for a different requirement; the page sends the new candidates.
 *
 * The grid flows by column with a fixed number of rows, so each candidate is a column and every row lines up
 * without measuring anything.
 */
export function AlternativesPicker({ kind, insteadOf, filters, onFilter, candidates, rows, selected, onSelect, busy, onClose, defaultDetails = false }: {
  kind: ReactNode;
  /** The name of the product being replaced, when this is a swap. */
  insteadOf?: string;
  filters?: { id: string; label: string; on: boolean }[];
  onFilter?: (id: string) => void;
  candidates: Candidate[];
  rows: PickerRow[];
  selected?: string;
  onSelect: (id: string) => void;
  busy?: boolean;
  onClose?: () => void;
  /** The aligned fact rows start open (the workspace has the room); closed, each candidate is picture, price and its one line. */
  defaultDetails?: boolean;
}) {
  const tx = useText(WIDGET_TEXT);
  const [details, setDetails] = useState(defaultDetails);
  const shown = details ? rows : [];
  const rowCount = 3 + shown.length + 1;
  const edge = (on: boolean) => (on ? "border-petrol" : "border-line");
  return (
    <ThreadCard
      kind={kind}
      mark={<ArrowLeftRight aria-hidden size={14} />}
      aside={
        onClose ? (
          <button type="button" aria-label={tx.picker.close} onClick={onClose} className="-my-2 -mr-2 flex size-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface hover:text-ink">
            <X aria-hidden size={17} />
          </button>
        ) : undefined
      }
    >
      {insteadOf && <p className="text-[0.95rem] leading-snug [overflow-wrap:anywhere]">{tx.picker.insteadOf(insteadOf)}</p>}
      {filters && filters.length > 0 && (
        <div role="group" aria-label={tx.picker.rank} className={`-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] ${insteadOf ? "mt-3" : ""}`}>
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={f.on}
              onClick={() => onFilter?.(f.id)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[0.86rem] font-medium transition-[background-color,border-color,color] duration-150 pointer-coarse:min-h-11 ${f.on ? "border-petrol bg-petrol text-paper" : "border-line-strong bg-paper text-ink hover:border-petrol hover:bg-petrol-soft"}`}
            >
              {f.on && <Check aria-hidden size={14} strokeWidth={2.6} className="-ml-0.5" />}
              {f.label}
            </button>
          ))}
        </div>
      )}

      {candidates.length === 0 ? (
        <p className="mt-3 rounded-lg bg-surface px-3.5 py-4 text-[0.92rem] leading-snug text-ink-soft">{tx.picker.none}</p>
      ) : (
        <>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            {candidates.length > 1 ? <p className="text-[0.78rem] text-ink-soft sm:invisible">{tx.picker.swipe(candidates.length)}</p> : <span />}
            {rows.length > 0 && (
              <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className={`${quietAction} -mr-1 shrink-0`}>
                {tx.picker.details(details)}
                <ChevronDown aria-hidden size={15} className={`transition-transform duration-150 motion-reduce:transition-none ${details ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
          <div
            aria-busy={busy || undefined}
            className={`-mx-4 mt-1 grid snap-x snap-mandatory grid-flow-col gap-x-2.5 overflow-x-auto px-4 pb-1 transition-opacity duration-150 [scrollbar-width:thin] ${busy ? "opacity-50" : ""}`}
            style={{ gridTemplateRows: `repeat(${rowCount}, auto)`, gridAutoColumns: `minmax(min(15.5rem, 74%), 1fr)` }}
          >
            {candidates.map((c) => {
              const on = selected === c.id;
              const b = edge(on);
              const side = `border-x ${b} ${on ? "bg-petrol-soft/40" : "bg-paper"} px-3.5`;
              return [
                <div key={`${c.id}-head`} className={`snap-start rounded-t-lg border-t pt-3.5 ${side}`}>
                  <div className="flex items-start gap-3">
                    <Thumb art={c.art} className="size-16" />
                    <div className="min-w-0 flex-1">
                      {c.badge && <p className={`mb-1 inline-block rounded-full px-2 text-[0.72rem] font-semibold leading-5 ${c.badge === "usual" ? "bg-lavender-deep text-paper" : "bg-surface text-ink"}`}>{tx.picker.badge[c.badge]}</p>}
                      <p className="font-semibold leading-snug [overflow-wrap:anywhere]">{c.name}</p>
                      <p className="text-[0.82rem] leading-snug text-ink-soft tabular">{c.pack}</p>
                    </div>
                  </div>
                </div>,
                <div key={`${c.id}-price`} className={`${side} pt-2.5`}>
                  <p className="display text-[1.35rem] leading-none tabular">{c.price}</p>
                  {c.per && <p className="mt-1 text-[0.8rem] text-ink-soft tabular">{c.per}</p>}
                </div>,
                <div key={`${c.id}-headline`} className={`${side} pb-1 pt-2.5`}>
                  <p className={`flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-[0.86rem] font-medium leading-snug ${c.badge === "usual" ? "bg-lavender text-lavender-deep" : "bg-surface text-ink"}`}>
                    {c.badge === "usual" && <Sparkles aria-hidden size={14} className="mt-[0.15em] shrink-0" />}
                    {c.headline}
                  </p>
                </div>,
                ...shown.map((r, i) => {
                  const cell = c.cells[r.key];
                  const tone = cell?.tone === "better" ? "text-good" : cell?.tone === "worse" ? "text-notice" : cell?.tone === "same" ? "text-ink-soft" : "text-ink";
                  return (
                    <div key={`${c.id}-${r.key}`} className={`${side} py-2 ${i > 0 ? "" : ""}`}>
                      <div className="border-t border-line/80 pt-2">
                        <p className="text-[0.72rem] leading-tight text-ink-soft">{r.label}</p>
                        <p className={`mt-0.5 flex items-start gap-1.5 text-[0.9rem] leading-snug tabular ${tone}`}>
                          {cell?.tone === "better" && <Check aria-hidden size={14} strokeWidth={2.6} className="mt-[0.2em] shrink-0" />}
                          {cell?.tone === "worse" && <Minus aria-hidden size={14} strokeWidth={2.6} className="mt-[0.2em] shrink-0" />}
                          <span className={cell?.tone === "better" || cell?.tone === "worse" ? "font-medium" : ""}>{cell?.text ?? "–"}</span>
                        </p>
                      </div>
                    </div>
                  );
                }),
                <div key={`${c.id}-foot`} className={`flex flex-col justify-end rounded-b-lg border-b pb-3.5 pt-2 ${side}`}>
                  {c.signOff && (
                    <p className="mb-2.5 flex items-start gap-2 rounded-md bg-safety-soft px-2.5 py-1.5 text-[0.82rem] leading-snug">
                      <Target size={14} tone="safety" className="mt-[0.15em] shrink-0" />
                      {c.signOff}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={busy || on}
                    onClick={() => onSelect(c.id)}
                    className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full text-[0.9rem] font-semibold transition-colors duration-150 disabled:cursor-default ${on ? "bg-petrol text-paper" : c.badge === "current" ? "border border-line-strong bg-paper text-ink hover:border-ink-soft hover:bg-mist" : "bg-lime text-ink hover:bg-lime-hover"}`}
                  >
                    {on && <Check aria-hidden size={15} strokeWidth={2.6} />}
                    {on ? tx.picker.chosen : c.badge === "current" ? tx.picker.keep : tx.picker.choose}
                  </button>
                </div>,
              ];
            })}
          </div>
        </>
      )}
    </ThreadCard>
  );
}

// ---------- the menu builder ----------

export type MenuProposal = {
  id: string;
  title: string;
  /** "beetroot". */
  around: string;
  dishes: string[];
  /** The kitchen's rules it respects, in a word or two each: "no nuts", "lactose-free". */
  respects: string[];
  /** "3,40 € per cover", formatted. */
  perCover?: string;
  /** Something the buyer should know before choosing: "one dish needs an oven for 40". */
  warning?: string;
  art?: string;
};

/**
 * Menu ideas as selectable cards. While the planner is still working (`forming`), the ideas that are ready are
 * shown and the rest hold their place, with the planner's steps above: the buyer watches the plan form instead of
 * a spinner, and can already choose the first idea.
 */
export function MenuProposals({ kind, intro, proposals, selected, onSelect, forming }: {
  kind: ReactNode;
  intro?: ReactNode;
  proposals: MenuProposal[];
  selected?: string;
  onSelect: (id: string) => void;
  /** Set while planning: how many ideas there will be, and what the planner is doing now. */
  forming?: { of: number; steps?: Step[] };
}) {
  const tx = useText(WIDGET_TEXT);
  const waiting = forming ? Math.max(0, forming.of - proposals.length) : 0;
  return (
    <ThreadCard
      kind={kind}
      mark={<UtensilsCrossed aria-hidden size={14} />}
      aside={forming ? <span className="inline-flex items-center gap-1.5 tabular"><Spinner size={13} />{tx.menu.formingOf(proposals.length, forming.of)}</span> : undefined}
    >
      {intro && <p className="text-[0.95rem] leading-relaxed">{intro}</p>}
      {forming?.steps && forming.steps.length > 0 && (
        <div className={intro ? "mt-2" : ""}>
          <StepLines steps={forming.steps} fold={false} />
        </div>
      )}
      <ul className={`grid gap-2.5 @container md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] ${intro || forming?.steps?.length ? "mt-3" : ""}`}>
        {proposals.map((p) => {
          const on = selected === p.id;
          return (
            <li key={p.id} className={`lane-enter flex flex-col overflow-hidden rounded-lg border transition-[border-color,box-shadow,opacity] duration-150 ${on ? "border-petrol shadow-[0_0_0_1px_var(--color-petrol)]" : "border-line"} ${selected && !on ? "opacity-55" : ""}`}>
              {hasArt(p.art) && (
                <div className="h-20 bg-surface">
                  <Art k={p.art} sizes="20rem" cover className="size-full" imgClassName="size-full object-cover" />
                </div>
              )}
              <div className="flex flex-1 flex-col p-3.5">
                <p className="display text-[1.15rem] leading-tight [overflow-wrap:anywhere]">{p.title}</p>
                <p className="mt-1 text-[0.82rem] text-ink-soft">
                  {tx.menu.builtAround}: <span className="font-medium text-ink">{p.around}</span>
                </p>
                <ul className="mt-2.5 space-y-1 text-[0.9rem] leading-snug">
                  {p.dishes.map((d, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-petrol" />
                      <span className="[overflow-wrap:anywhere]">{d}</span>
                    </li>
                  ))}
                </ul>
                {p.respects.length > 0 && (
                  <p className="mt-3 flex flex-wrap gap-1.5" aria-label={tx.menu.respects}>
                    {p.respects.map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2 text-[0.76rem] font-medium leading-6 text-good">
                        <Check aria-hidden size={12} strokeWidth={2.8} />
                        {r}
                      </span>
                    ))}
                  </p>
                )}
                {p.warning && (
                  <p className="mt-2.5 flex items-start gap-2 text-[0.84rem] leading-snug text-notice">
                    <CircleAlert aria-hidden size={14} className="mt-[0.15em] shrink-0" />
                    <span className="text-ink">{p.warning}</span>
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between gap-3 pt-3.5">
                  {p.perCover ? <p className="text-[0.86rem] text-ink-soft tabular">{p.perCover}</p> : <span />}
                  <button type="button" disabled={on} onClick={() => onSelect(p.id)} className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-[0.9rem] font-semibold transition-colors duration-150 disabled:cursor-default pointer-coarse:min-h-11 ${on ? "bg-petrol text-paper" : "bg-lime text-ink hover:bg-lime-hover"}`}>
                    {on && <Check aria-hidden size={15} strokeWidth={2.6} />}
                    {on ? tx.menu.chosen : tx.menu.choose}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
        {Array.from({ length: waiting }, (_, i) => (
          <li key={`w${i}`} aria-hidden className="rounded-lg border border-dashed border-line p-3.5">
            <span className="skeleton block h-5 w-2/3" />
            <span className="skeleton mt-3 block h-3 w-1/2" />
            <span className="skeleton mt-2 block h-3 w-4/5" />
            <span className="skeleton mt-2 block h-3 w-3/5" />
            <span className="skeleton mt-4 block h-9 w-28 rounded-full" />
          </li>
        ))}
      </ul>
    </ThreadCard>
  );
}

export type MenuIngredient = {
  id: string;
  /** "Beetroot". */
  name: string;
  /** What the dish needs for the covers: "6 kg". */
  amount: string;
  /** The product chosen for it. Absent with `missing` set when nothing in the assortment fits. */
  product?: { name: string; packs: string; price: string; art?: string };
  /** The kitchen already has it: it is not ordered. */
  have?: boolean;
  /** A kitchen rule this line breaks: "contains hazelnut; the kitchen's rule is no nuts". */
  conflict?: string;
  /** Why there is no product: "no lactose-free crème fraîche arrives by Thursday". */
  missing?: string;
  state?: "ok" | "updating";
};

export type MenuDish = { id: string; name: string; note?: string; ingredients: MenuIngredient[] };

/**
 * The chosen menu as a working sheet. Dishes can be dropped or swapped; the covers stepper rescales every amount
 * (the engine recalculates, `busy` shows it); each ingredient shows the product chosen for it, with swap, a "we have
 * this" switch, and a rule conflict on the line it concerns. The summary says what will be ordered and what a cover
 * costs; the one button goes on to the order sheet.
 */
export function MenuSheet({ kind, title, covers, onCovers, coverStep = 10, dishes, onDropDish, onSwapDish, onSwapIngredient, onHave, summary, confirm, onConfirm, busy, settled }: {
  kind: ReactNode;
  title: string;
  covers: number;
  onCovers: (n: number) => void;
  coverStep?: number;
  dishes: MenuDish[];
  onDropDish?: (dishId: string) => void;
  onSwapDish?: (dishId: string) => void;
  onSwapIngredient?: (dishId: string, ingredientId: string) => void;
  onHave?: (dishId: string, ingredientId: string, have: boolean) => void;
  summary: { toOrder: number; inKitchen: number; total: string; perCover: string };
  confirm: string;
  onConfirm: () => void;
  busy?: boolean;
  settled?: boolean;
}) {
  const tx = useText(WIDGET_TEXT);
  const conflicts = dishes.some((d) => d.ingredients.some((i) => i.conflict && !i.have));
  // A dish opens by itself only when something in it needs the buyer; otherwise its ingredients are one tap away.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  return (
    <ThreadCard kind={kind} mark={<UtensilsCrossed aria-hidden size={14} />} aside={busy ? <span className="inline-flex items-center gap-1.5"><Spinner size={13} />{tx.menu.rescaling}</span> : undefined}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h3 className="display min-w-0 text-[1.35rem] leading-tight [overflow-wrap:anywhere]">{title}</h3>
        <Stepper value={covers} min={coverStep} step={coverStep} onChange={onCovers} less={tx.menu.coversLess} more={tx.menu.coversMore} label={tx.menu.covers} disabled={settled} size="lg">
          {tx.menu.covers.toLowerCase()}
        </Stepper>
      </div>

      <div className="mt-4 space-y-4">
        {dishes.map((d) => {
          const toCheck = d.ingredients.filter((g) => !g.have && (g.conflict || g.missing)).length;
          const open = opened[d.id] ?? toCheck > 0;
          return (
          <section key={d.id} aria-label={d.name} className="rounded-lg bg-surface/70 p-3">
            <header className="flex items-start gap-1">
              <button type="button" aria-expanded={open} onClick={() => setOpened((o) => ({ ...o, [d.id]: !open }))} className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-md px-0.5 text-left transition-colors hover:bg-paper/70">
                <ChevronDown aria-hidden size={17} className={`mt-[0.2em] shrink-0 text-ink-soft transition-transform duration-150 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`} />
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug [overflow-wrap:anywhere]">{d.name}</span>
                  <span className="block text-[0.82rem] leading-snug text-ink-soft">
                    {d.note && <span>{d.note} · </span>}
                    {tx.menu.ingredients(d.ingredients.length)}
                    {toCheck > 0 && <span className="font-semibold text-notice"> · {tx.menu.toCheck(toCheck)}</span>}
                  </span>
                </span>
              </button>
              {!settled && (
                <span className="-mr-1 flex shrink-0">
                  {onSwapDish && (
                    <button type="button" aria-label={`${tx.menu.swapDish}: ${d.name}`} onClick={() => onSwapDish(d.id)} className="flex size-10 items-center justify-center rounded-full text-petrol transition-colors hover:bg-petrol-soft pointer-coarse:size-11">
                      <ArrowLeftRight aria-hidden size={16} />
                    </button>
                  )}
                  {onDropDish && (
                    <button type="button" aria-label={`${tx.menu.dropDish}: ${d.name}`} onClick={() => onDropDish(d.id)} className="flex size-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-ink pointer-coarse:size-11">
                      <Trash2 aria-hidden size={16} />
                    </button>
                  )}
                </span>
              )}
            </header>
            {open && (
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-md border border-line bg-paper">
              {d.ingredients.map((g) => (
                <li key={g.id} className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className={`min-w-0 leading-snug ${g.have ? "text-ink-soft" : ""}`}>
                      <span className="font-medium [overflow-wrap:anywhere]">{g.name}</span>{" "}
                      {g.state === "updating" ? <span className="skeleton inline-block h-3.5 w-10 align-middle" /> : <span className="whitespace-nowrap text-[0.9rem] text-ink-soft tabular">{g.amount}</span>}
                    </p>
                    {onHave && (
                      <Switch on={!!g.have} onChange={(v) => onHave(d.id, g.id, v)} disabled={settled} className="shrink-0 flex-row-reverse">
                        <span className="text-[0.84rem] text-ink-soft">{tx.menu.have}</span>
                      </Switch>
                    )}
                  </div>
                  {g.product && !g.have && (
                    <div className="mt-2 flex items-center gap-2.5">
                      <Thumb art={g.product.art} className="size-10" />
                      <p className="min-w-0 flex-1 text-[0.84rem] leading-snug">
                        <span className="block [overflow-wrap:anywhere]">{g.product.name}</span>
                        <span className="block text-ink-soft tabular">
                          {g.product.packs} · {g.product.price}
                        </span>
                      </p>
                      {onSwapIngredient && !settled && (
                        <button type="button" aria-label={`${tx.sheet.swap}: ${g.product.name}`} onClick={() => onSwapIngredient(d.id, g.id)} className={`${quietAction} shrink-0`}>
                          <ArrowLeftRight aria-hidden size={15} />
                          <span className="max-[24rem]:sr-only">{tx.sheet.swap}</span>
                        </button>
                      )}
                    </div>
                  )}
                  {g.missing && !g.have && (
                    <p className="mt-2 flex items-start gap-2 rounded-md bg-notice-soft px-2.5 py-1.5 text-[0.84rem] leading-snug text-notice">
                      <CircleAlert aria-hidden size={14} className="mt-[0.15em] shrink-0" />
                      <span className="text-ink">
                        <span className="font-semibold">{tx.menu.noProduct}.</span> {g.missing}
                      </span>
                    </p>
                  )}
                  {g.conflict && !g.have && (
                    <p className="mt-2 flex items-start gap-2 rounded-md bg-bad-soft px-2.5 py-1.5 text-[0.84rem] leading-snug text-bad">
                      <CircleAlert aria-hidden size={14} className="mt-[0.15em] shrink-0" />
                      <span className="text-ink">
                        <span className="font-semibold text-bad">{tx.menu.conflict}.</span> {g.conflict}
                      </span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
            )}
          </section>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3.5">
        <p className="text-[0.88rem] leading-snug text-ink-soft">
          <span className="block font-medium text-ink">{tx.menu.toOrder(summary.toOrder)}</span>
          {summary.inKitchen > 0 && <span className="block">{tx.menu.inKitchen(summary.inKitchen)}</span>}
        </p>
        {busy ? (
          <span className="skeleton block h-8 w-32" />
        ) : (
          <p className="text-right">
            <span className="display block text-[1.6rem] leading-none tabular">{summary.total}</span>
            <span className="mt-1 block text-[0.82rem] text-ink-soft tabular">
              {summary.perCover} {tx.menu.perCover}
            </span>
          </p>
        )}
      </div>
      {!settled && (
        <button type="button" disabled={busy || conflicts} onClick={onConfirm} className={`${buttonClass("go", "lg")} mt-3 w-full`}>
          {busy && <Spinner size={16} />}
          <span className="tabular">{confirm}</span>
        </button>
      )}
    </ThreadCard>
  );
}

// ---------- answering without typing ----------

/** A question that has a safe default can be skipped: the label says what the default is ("Skip: use your usual"). */
export type AnswerSkip = { label: string; onClick: () => void };

function AnswerFrame({ kind, question, why, children, answered, skip }: { kind: ReactNode; question: ReactNode; why?: ReactNode; children: ReactNode; answered?: boolean; skip?: AnswerSkip }) {
  const tx = useText(WIDGET_TEXT);
  return (
    <ThreadCard kind={kind} mark={<CircleHelp aria-hidden size={14} />} aside={answered ? <span className="inline-flex items-center gap-1 text-good"><Check aria-hidden size={13} strokeWidth={2.8} />{tx.answer.answered}</span> : undefined}>
      <p className="text-[1.02rem] font-semibold leading-snug">{question}</p>
      {why && (
        <p className="mt-1 text-[0.84rem] leading-snug text-ink-soft">
          <span className="font-medium">{tx.answer.why}:</span> {why}
        </p>
      )}
      <div className="mt-3">{children}</div>
      {skip && !answered && (
        <button type="button" onClick={skip.onClick} className={`${quietAction} -ml-2.5 mt-2`}>
          {skip.label}
        </button>
      )}
    </ThreadCard>
  );
}

export type AnswerChoice = { id: string; label: string; hint?: string };

/** A question with fixed answers, as chips. One tap answers it; with `multiple`, several can be on. */
export function ChoiceAnswer({ kind, question, why, choices, chosen, onChoose, multiple , skip}: { skip?: AnswerSkip; kind: ReactNode; question: ReactNode; why?: ReactNode; choices: AnswerChoice[]; chosen?: string[]; onChoose: (id: string) => void; multiple?: boolean }) {
  const picked = chosen ?? [];
  const done = !multiple && picked.length > 0;
  return (
    <AnswerFrame skip={skip} kind={kind} question={question} why={why} answered={done}>
      <div role={multiple ? "group" : "radiogroup"} className="flex flex-wrap gap-2">
        {choices.map((c) => {
          const on = picked.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              role={multiple ? undefined : "radio"}
              aria-checked={multiple ? undefined : on}
              aria-pressed={multiple ? on : undefined}
              onClick={() => onChoose(c.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-left text-[0.92rem] font-medium leading-tight transition-[background-color,border-color,color,opacity] duration-150 ${on ? "border-petrol bg-petrol text-paper" : `border-line-strong bg-paper text-ink hover:border-petrol hover:bg-petrol-soft ${done ? "opacity-50" : ""}`}`}
            >
              {on && <Check aria-hidden size={15} strokeWidth={2.6} className="-ml-1 shrink-0" />}
              <span>
                {c.label}
                {c.hint && <span className={`ml-1.5 text-[0.8rem] font-normal ${on ? "text-paper/80" : "text-ink-soft"}`}>{c.hint}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </AnswerFrame>
  );
}

/** "Which day?", limited to the days that are possible. */
export function DayAnswer({ kind, question, why, days, day, onDay , skip}: { skip?: AnswerSkip; kind: ReactNode; question: ReactNode; why?: ReactNode; days: DayChoice[]; day?: string; onDay: (id: string) => void }) {
  const tx = useText(WIDGET_TEXT);
  return (
    <AnswerFrame skip={skip} kind={kind} question={question} why={why} answered={!!day}>
      <DayRow days={days} day={day} onDay={onDay} label={tx.sheet.day} />
    </AnswerFrame>
  );
}

/** "How much?", as a stepper with its unit, the kitchen's usual beside it, and one button to confirm. */
export function AmountAnswer({ kind, question, why, value, onChange, unit, step = 1, min = 0, max, usual, presets, confirm, onConfirm, answered , skip}: { skip?: AnswerSkip; kind: ReactNode; question: ReactNode; why?: ReactNode; value: number; onChange: (n: number) => void; unit: string; step?: number; min?: number; max?: number; usual?: string; presets?: { value: number; label: string }[]; confirm: string; onConfirm: () => void; answered?: boolean }) {
  const tx = useText(WIDGET_TEXT);
  return (
    <AnswerFrame skip={skip} kind={kind} question={question} why={why} answered={answered}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Stepper value={value} onChange={onChange} min={min} max={max} step={step} less={tx.answer.less} more={tx.answer.more} label={unit} size="lg" disabled={answered}>
          {unit}
        </Stepper>
        {usual && <p className="text-[0.86rem] text-ink-soft tabular">{tx.answer.usual(usual)}</p>}
      </div>
      {presets && presets.length > 0 && !answered && (
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p.value} type="button" onClick={() => onChange(p.value)} className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-[0.86rem] font-medium tabular transition-colors duration-150 pointer-coarse:min-h-11 ${p.value === value ? "border-petrol bg-petrol-soft text-petrol-deep" : "border-line-strong bg-paper hover:border-petrol hover:bg-petrol-soft"}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {!answered && (
        <button type="button" onClick={onConfirm} className={`${buttonClass("primary", "md")} mt-3.5`}>
          <span className="tabular">{confirm}</span>
        </button>
      )}
    </AnswerFrame>
  );
}

/** A yes or no, with the reason the question is asked. The words of the two answers can say what each one does. */
export function YesNoAnswer({ kind, question, why, yes, no, onAnswer, answered , skip}: { skip?: AnswerSkip; kind: ReactNode; question: ReactNode; why?: ReactNode; yes?: string; no?: string; onAnswer: (answer: "yes" | "no") => void; answered?: "yes" | "no" }) {
  const tx = useText(WIDGET_TEXT);
  const btn = (which: "yes" | "no", label: string) => {
    const on = answered === which;
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={!!answered}
        onClick={() => onAnswer(which)}
        className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border px-4 text-[0.92rem] font-semibold transition-[background-color,border-color,color,opacity] duration-150 disabled:cursor-default ${on ? "border-petrol bg-petrol text-paper" : which === "yes" ? `border-petrol bg-paper text-petrol-deep hover:bg-petrol-soft ${answered ? "opacity-45" : ""}` : `border-line-strong bg-paper text-ink hover:border-ink-soft hover:bg-mist ${answered ? "opacity-45" : ""}`}`}
      >
        {on && <Check aria-hidden size={15} strokeWidth={2.6} />}
        {label}
      </button>
    );
  };
  return (
    <AnswerFrame skip={skip} kind={kind} question={question} why={why} answered={!!answered}>
      <div className="flex flex-wrap gap-2.5">
        {btn("yes", yes ?? tx.answer.yes)}
        {btn("no", no ?? tx.answer.no)}
      </div>
    </AnswerFrame>
  );
}

// ---------- opening in place instead of navigating ----------

/**
 * Something that opens where it is: an order's details, a price's proof, why products were left out. The summary is
 * a full-width row; the content unfolds under it and the thread stays where it was. Use it inside a card or between
 * cards, anywhere a link to another page would have gone.
 */
export function InPlace({ summary, children, defaultOpen = false, count }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; count?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-[0.9rem] font-medium text-petrol transition-colors duration-150 hover:bg-petrol-soft/60">
        <ChevronDown aria-hidden size={16} className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`} />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{summary}</span>
        {count !== undefined && <span className="shrink-0 text-[0.82rem] text-ink-soft tabular">{count}</span>}
      </button>
      <div id={id} className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="pb-1 pl-7 pr-1 pt-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Label and value rows for anything opened in place: an order's facts, a signed price's proof. */
export function FactRows({ rows }: { rows: { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="divide-y divide-line/80 text-[0.88rem] leading-snug">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="shrink-0 text-ink-soft">{r.label}</dt>
          <dd className={`min-w-0 text-right [overflow-wrap:anywhere] ${r.mono ? "font-mono text-[0.8rem]" : "tabular"}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Why products were not offered: one line per reason with how many, the names on request. */
export function LeftOut({ groups }: { groups: { reason: string; count: number; names?: string[] }[] }) {
  return (
    <ul className="space-y-2 text-[0.88rem] leading-snug">
      {groups.map((g) => (
        <li key={g.reason}>
          <p className="flex items-baseline gap-2">
            <span className="tabular shrink-0 rounded-full bg-surface px-2 text-[0.78rem] font-semibold leading-5">{g.count}</span>
            <span>{g.reason}</span>
          </p>
          {g.names && g.names.length > 0 && <p className="ml-9 mt-0.5 text-[0.82rem] text-ink-soft [overflow-wrap:anywhere]">{g.names.join(", ")}</p>}
        </li>
      ))}
    </ul>
  );
}

export type RememberItem = { id: string; text: string; source?: string; keep: boolean };

/**
 * "Remember this?" after an order: what the agent would keep, each with a switch, and one button to save. Nothing
 * is remembered until the person saves it.
 */
export function RememberThis({ kind, items, onToggle, onSave, saved }: { kind: ReactNode; items: RememberItem[]; onToggle: (id: string, keep: boolean) => void; onSave: () => void; saved?: boolean }) {
  const tx = useText(WIDGET_TEXT);
  return (
    <ThreadCard kind={kind} tone="agent" mark={<Sparkles aria-hidden size={14} />} aside={saved ? <span className="inline-flex items-center gap-1 text-good"><Check aria-hidden size={13} strokeWidth={2.8} />{tx.more.saved}</span> : undefined}>
      <ul className="divide-y divide-lavender-mid/60">
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2 first:pt-0">
            <p className={`min-w-0 flex-1 text-[0.92rem] leading-snug ${m.keep ? "" : "text-ink-soft line-through decoration-ink-soft/40"}`}>
              {m.text}
              {m.source && <span className="block text-[0.8rem] text-ink-soft no-underline">{m.source}</span>}
            </p>
            <Switch on={m.keep} onChange={(v) => onToggle(m.id, v)} disabled={saved}>
              <span className="sr-only">{m.keep ? tx.more.keep : tx.more.forget}</span>
            </Switch>
          </li>
        ))}
      </ul>
      {!saved && (
        <button type="button" onClick={onSave} disabled={!items.some((m) => m.keep)} className={`${buttonClass("primary", "sm")} mt-2.5`}>
          {tx.more.save}
        </button>
      )}
    </ThreadCard>
  );
}
