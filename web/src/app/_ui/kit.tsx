"use client";

import Link from "next/link";
import { Check, ChevronDown, ChevronLeft, CircleAlert, Sparkles, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { useText } from "../_i18n/provider";
import { money } from "./plain";
import { KIT_TEXT } from "./kit.text";

/**
 * AimoPilot's shared components (see web/docs/DESIGN.md). Calm and bright: white surfaces with hairlines on a mist
 * ground, pill controls, lime for the one main action in view, lavender for the agent, warning yellow only at the
 * gate. Every surface on the customer side is built from these, and the operations kit builds on them too.
 *
 * Shape by role: controls are pills, fields 12, cards 20, feature surfaces 28. Do not put one radius on everything.
 */

// ---------- buttons ----------

export type ButtonKind = "go" | "primary" | "secondary" | "quiet" | "safety" | "dark" | "ghost-dark";
export type ButtonSize = "sm" | "md" | "lg";

const LOOK: Record<ButtonKind, string> = {
  // The one main action in view: lime with ink text.
  go: "bg-lime text-ink shadow-xs hover:bg-lime-hover",
  // Strong but not the main action: solid petrol.
  primary: "bg-petrol text-paper hover:bg-petrol-deep",
  secondary: "border border-line-strong bg-paper text-ink hover:border-ink-soft hover:bg-mist",
  quiet: "text-petrol underline decoration-petrol/30 underline-offset-4 hover:text-petrol-deep hover:decoration-petrol",
  // Gate only: a person decides.
  safety: "bg-safety text-safety-ink hover:brightness-95",
  dark: "bg-ink text-paper hover:bg-petrol-deep",
  "ghost-dark": "border border-paper/35 bg-paper/5 text-paper hover:bg-paper/15",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3.5 text-[0.875rem] pointer-coarse:min-h-11 max-sm:min-h-11",
  md: "min-h-11 px-5 text-[0.95rem]",
  lg: "min-h-13 px-6 text-[1.05rem]",
};

export function buttonClass(kind: ButtonKind = "secondary", size: ButtonSize = "md", extra = ""): string {
  return `relative inline-flex items-center justify-center gap-2 rounded-full font-semibold leading-tight transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-not-allowed ${kind === "quiet" ? "min-h-11 px-0" : SIZE[size]} ${LOOK[kind]} ${extra}`;
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  kind?: ButtonKind;
  size?: ButtonSize;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  ariaLabel?: string;
};

export function Button({ children, onClick, busy, disabled, pressed, kind = "secondary", size = "md", type = "button", className = "", title, ariaLabel }: ButtonProps) {
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-pressed={pressed}
      className={`${buttonClass(kind, size, className)} ${pressed ? "" : "disabled:opacity-50"}`}
    >
      {busy && <Spinner size={16} />}
      {children}
    </button>
  );
}

/** A round button that is only an icon: always named for screen readers, always a full tap target. */
export function IconButton({ children, label, onClick, tone = "plain", className = "", pressed, expanded, controls }: { children: ReactNode; label: string; onClick?: () => void; tone?: "plain" | "agent" | "dark" | "petrol"; className?: string; pressed?: boolean; expanded?: boolean; controls?: string }) {
  const look =
    tone === "agent"
      ? "bg-lavender text-lavender-deep hover:bg-lavender-mid"
      : tone === "dark"
        ? "text-paper hover:bg-paper/15"
        : tone === "petrol"
          ? "bg-petrol text-paper hover:bg-petrol-deep"
          : "text-ink-soft hover:bg-surface hover:text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${look} ${className}`}
    >
      {children}
    </button>
  );
}

// ---------- working, waiting ----------

/** In a button that is busy, and nowhere else: pages that load show the shape of what is coming (Skeleton). */
export function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={`inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      <span className="spin block size-full rounded-full border-2 border-current border-r-transparent" />
    </span>
  );
}

export function Working({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-2 text-ink-soft ${className}`} role="status">
      <Spinner size={16} className="text-petrol" /> {children}
    </p>
  );
}

/** A loading placeholder in the shape of what is coming. */
export function Skeleton({ className = "", label }: { className?: string; label?: string }) {
  return <div aria-label={label} role={label ? "status" : undefined} className={`skeleton ${className}`} />;
}

// ---------- surfaces ----------

/**
 * A card: white, a hairline, the container radius. Flat unless `raise`.
 * Use it for a thing that stands on its own (an order, a product, a summary). A group of rows is a list inside one
 * card, not a card per row; a quiet aside is a Panel.
 */
export function Card({ children, className = "", as: As = "div", raise = false, pad = false }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li"; raise?: boolean; pad?: boolean }) {
  return <As className={`overflow-hidden rounded-xl border border-line bg-paper ${raise ? "shadow-sm" : ""} ${pad ? "p-5 sm:p-6" : ""} ${className}`}>{children}</As>;
}

/** A tinted panel with no border: an aside, a group of figures, a note. The tint says whose it is. */
export function Panel({ children, className = "", tone = "surface" }: { children: ReactNode; className?: string; tone?: "surface" | "agent" | "petrol" | "good" | "waiting" }) {
  const look = tone === "agent" ? "bg-lavender" : tone === "petrol" ? "bg-petrol-soft" : tone === "good" ? "bg-good-soft" : tone === "waiting" ? "bg-safety-soft" : "bg-surface";
  return <div className={`rounded-lg ${look} ${className}`}>{children}</div>;
}

/**
 * A document or a panel (the older name; pages still use it): a card.
 *   tone "agent"  lavender: the agent remembered, inferred or wrote this
 *   tone "gate"   the hazard band: a person must act, or the gate refused (gate only)
 * `rule` once drew a petrol top rule; the new system has none, so it is accepted and ignored.
 */
export function Plate({ children, className = "", tone = "paper", as: As = "div" }: { children: ReactNode; className?: string; tone?: "paper" | "agent" | "gate"; as?: "div" | "section" | "article"; rule?: boolean }) {
  return (
    <As className={`overflow-hidden rounded-xl border ${tone === "agent" ? "border-lavender-mid bg-lavender" : tone === "gate" ? "border-safety-ink/15 bg-paper shadow-sm" : "border-line bg-paper"} ${className}`}>
      {tone === "gate" && <div aria-hidden className="hazard h-1.5" />}
      {children}
    </As>
  );
}

/** A labelled value: small label, the value under it. */
export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[0.8rem] leading-tight text-ink-soft">{label}</dt>
      <dd className="mt-1 text-[1.02rem] font-semibold leading-snug">{children}</dd>
    </div>
  );
}

/** A value the data does not have: said plainly, never left blank. */
export function Missing({ children }: { children: ReactNode }) {
  return <span className="rounded-xs border border-dashed border-line-strong px-1.5 py-px text-[0.9rem] italic text-ink-soft">{children}</span>;
}

export type TagTone = "plain" | "petrol" | "agent" | "muted" | "safety" | "good" | "bad";

/** A small pill: a dietary claim, a certificate, a status word. */
export function Tag({ children, tone = "plain", title }: { children: ReactNode; tone?: TagTone; title?: string }) {
  const look: Record<TagTone, string> = {
    plain: "bg-petrol-soft text-petrol-deep",
    petrol: "bg-petrol text-paper",
    agent: "bg-lavender text-lavender-deep ring-1 ring-inset ring-lavender-mid",
    muted: "bg-surface text-ink-soft",
    safety: "bg-safety text-safety-ink",
    good: "bg-good-soft text-good",
    bad: "bg-bad-soft text-bad",
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[0.78rem] font-medium leading-6 ${look[tone]}`}>
      {children}
    </span>
  );
}

export type BadgeTone = "neutral" | "good" | "info" | "agent" | "waiting" | "refused" | "bad" | "staged";

/**
 * A status badge: a dot and a word. "waiting" and "refused" are the gate's and carry its colours; "good" is placed;
 * "staged" (dashed) marks a demo condition or sample activity; everything else is quiet. The same meaning wears the
 * same badge in the store and in operations. Never rely on the colour alone: the word says it.
 */
export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  const look: Record<BadgeTone, [string, string]> = {
    neutral: ["bg-surface text-ink-soft", "bg-ink-faint"],
    good: ["bg-good-soft text-good", "bg-good"],
    info: ["bg-petrol-soft text-petrol-deep", "bg-petrol"],
    agent: ["bg-lavender text-lavender-deep", "bg-lavender-deep"],
    waiting: ["bg-safety-soft text-safety-ink ring-1 ring-inset ring-safety/60", "bg-safety ring-1 ring-safety-ink/40"],
    refused: ["bg-safety-ink text-safety", "bg-safety"],
    bad: ["bg-bad-soft text-bad", "bg-bad"],
    // Set up for a demo or sample activity, not a real event: dashed, quiet, the same everywhere.
    staged: ["border border-dashed border-ink-faint bg-paper text-ink-soft", "bg-ink-faint"],
  };
  const [pill, dot] = look[tone];
  return (
    <span title={typeof children === "string" ? children : undefined} className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[0.8rem] font-semibold leading-6 ${pill} ${className}`}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      {/* A long status stays inside its pill on a narrow screen (the whole of it on hover). */}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Section heading in the display face, with an optional note or action on the right. */
export function SectionTitle({ id, children, aside, className = "" }: { id?: string; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={`mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${className}`}>
      <h2 id={id} className="display text-[1.5rem] text-ink sm:text-[1.625rem]">
        {children}
      </h2>
      {aside && <div className="text-[0.875rem] text-ink-soft">{aside}</div>}
    </div>
  );
}

/**
 * The top of a store or phone page: an optional `back` link or context line above, the title in the display face,
 * a lead under it (60 to 75 characters a line), and the page's actions on the right on a desk, under the lead on a
 * phone. No box: the page's hierarchy starts with type and space.
 */
export function PageHeader({ title, lead, context, back, actions, className = "", id }: { title: ReactNode; lead?: ReactNode; context?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode; className?: string; id?: string }) {
  return (
    <header className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-4 ${className}`}>
      <div className="min-w-0 max-w-[46rem] flex-1 basis-[22rem]">
        {back && (
          <Link href={back.href} className="-ml-1 mb-2 inline-flex min-h-9 items-center gap-1 rounded-full pl-1 pr-2.5 text-[0.9rem] font-medium text-petrol transition-colors hover:bg-petrol-soft pointer-coarse:min-h-11 max-sm:min-h-11">
            <ChevronLeft aria-hidden size={17} />
            {back.label}
          </Link>
        )}
        {context && <p className="text-[0.92rem] text-ink-soft">{context}</p>}
        <h1 id={id} className="display mt-1 break-words text-[1.95rem] leading-[1.08] text-ink hyphens-manual sm:text-[2.25rem]">
          {title}
        </h1>
        {lead && <div className="mt-2.5 max-w-[62ch] text-[1.02rem] leading-relaxed text-ink-soft">{lead}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/**
 * Facts as rows: the label on the left and the value on the right on a desk, the label above the value on a phone
 * (`stack={false}` keeps them side by side there too, for short values); hairlines between rows. For a product's facts, an order's details, a mandate's limits.
 */
export function FactList({ rows, className = "", labelWidth = "11rem", stack = true }: { rows: { label: ReactNode; value: ReactNode; key?: string }[]; className?: string; labelWidth?: string; stack?: boolean }) {
  return (
    <dl className={`divide-y divide-line ${className}`}>
      {rows.map((r, i) => (
        <div key={r.key ?? i} className={`grid gap-x-4 gap-y-0.5 py-3 first:pt-0 last:pb-0 sm:gap-x-5 ${stack ? "sm:grid-cols-[var(--facts-label)_minmax(0,1fr)]" : "grid-cols-[var(--facts-label)_minmax(0,1fr)]"}`} style={{ ["--facts-label" as string]: labelWidth }}>
          <dt className="text-[0.88rem] text-ink-soft hyphens-manual sm:text-[0.92rem]">{r.label}</dt>
          <dd className="min-w-0 break-words leading-snug">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Something went wrong: what happened and how to fix it. No apology. */
export function ErrorPlate({ title, message, onRetry, extra }: { title: string; message: string; onRetry?: () => void; extra?: { label: string; onClick: () => void } | false | undefined }) {
  const tx = useText(KIT_TEXT);
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-bad/20 bg-bad-soft px-4 py-3.5">
      <div className="flex min-w-0 items-start gap-3">
        <CircleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-bad" />
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="text-[0.95rem] text-ink-soft">{message}</p>
        </div>
      </div>
      {(onRetry || extra) && (
        <div className="flex flex-wrap items-center gap-4">
          {onRetry && (
            <Button onClick={onRetry} kind="secondary" size="sm">
              {tx.tryAgain}
            </Button>
          )}
          {extra && (
            <Button onClick={extra.onClick} kind="quiet">
              {extra.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** An empty state is a direction: what is not here yet, and the next thing to do. */
export function Empty({ title, children, action, glyph }: { title: string; children?: ReactNode; action?: ReactNode; glyph?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-xl border border-dashed border-line-strong bg-paper/60 p-5 sm:p-6">
      {glyph && <div className="shrink-0 text-petrol">{glyph}</div>}
      <div className="min-w-0 flex-1">
        <p className="text-[1.05rem] font-semibold">{title}</p>
        {children && <div className="mt-1 max-w-[62ch] text-[0.95rem] leading-relaxed text-ink-soft">{children}</div>}
        {action && <div className="mt-4 flex flex-wrap gap-3">{action}</div>}
      </div>
    </div>
  );
}

/** A soft round ground for an icon: empty states, list rows, the agent's mark. */
export function IconDisc({ children, tone = "petrol", size = 44, className = "" }: { children: ReactNode; tone?: "petrol" | "agent" | "good" | "muted" | "dark"; size?: number; className?: string }) {
  const look = tone === "agent" ? "bg-lavender text-lavender-deep" : tone === "good" ? "bg-good-soft text-good" : tone === "muted" ? "bg-surface text-ink-soft" : tone === "dark" ? "bg-paper/12 text-paper" : "bg-petrol-soft text-petrol";
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full ${look} ${className}`} style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

/** A note that a value came from the kitchen's memory or the agent, not from a question: the agent's spark. */
export function AgentNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-[0.95rem] leading-snug">
      <Sparkles aria-hidden size={15} className="mt-[0.2em] shrink-0 text-lavender-deep" />
      <span>{children}</span>
    </p>
  );
}

/** Keyboard key, for shortcuts shown next to a control. */
export function Kbd({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <kbd className={`inline-flex min-w-5 items-center justify-center rounded-xs border px-1 text-[0.7rem] font-medium leading-[1.15rem] ${dark ? "border-paper/30 text-paper/85" : "border-line-strong bg-paper text-ink-soft"}`}>{children}</kbd>
  );
}

// ---------- fields ----------

type FieldShell = { label?: string; hint?: ReactNode; error?: string; className?: string };

function Labelled({ id, label, hint, error, className = "", children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-[0.875rem] font-medium text-ink">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-note`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[0.85rem] text-bad">
          <CircleAlert aria-hidden size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : hint ? (
        <p id={`${id}-note`} className="mt-1.5 text-[0.85rem] text-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className" | "id" | "type" | "size">;

/**
 * A text field: label above, hint or error below, an optional icon inside on the left, an optional `suffix` inside on
 * the right (a unit: "€", "L"). Native attributes (min, max, minLength, pattern, autoFocus, enterKeyHint...) pass through.
 */
export function Input({
  label,
  hint,
  error,
  className = "",
  icon,
  suffix,
  value,
  onChange,
  type = "text",
  autoComplete = "off",
  id: givenId,
  fieldClassName = "",
  ...native
}: FieldShell & NativeInput & { icon?: ReactNode; suffix?: ReactNode; value?: string | number; onChange?: (v: string) => void; type?: string; id?: string; fieldClassName?: string }) {
  const auto = useId();
  const id = givenId ?? auto;
  return (
    <Labelled id={id} label={label} hint={hint} error={error} className={className}>
      <div className="relative">
        {icon && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-faint">{icon}</span>}
        <input
          {...native}
          id={id}
          type={type}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          className={`field ${icon ? "pl-10" : ""} ${suffix ? "pr-12" : ""} ${error ? "border-bad" : ""} ${fieldClassName}`}
        />
        {suffix && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[0.95rem] font-medium text-ink-soft">{suffix}</span>}
      </div>
    </Labelled>
  );
}

/** A field for a few lines of text, in the same look as `Input`. */
export function Textarea({ label, hint, error, className = "", value, onChange, rows = 3, id: givenId, ...native }: FieldShell & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "className" | "id"> & { value?: string; onChange?: (v: string) => void; id?: string }) {
  const auto = useId();
  const id = givenId ?? auto;
  return (
    <Labelled id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        {...native}
        id={id}
        rows={rows}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={`field min-h-24 resize-y py-2.5 leading-relaxed ${error ? "border-bad" : ""}`}
      />
    </Labelled>
  );
}

/**
 * A checkbox as a whole row: the box, the words and an optional line under them, all one 44 px target. Use `card` for
 * a choice that stands in a list of choices (a hairline pill that turns petrol when chosen).
 */
export function Checkbox({ checked, onChange, label, hint, name, value, disabled, card = false, className = "" }: { checked: boolean; onChange: (on: boolean) => void; label: ReactNode; hint?: ReactNode; name?: string; value?: string; disabled?: boolean; card?: boolean; className?: string }) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-start gap-3 ${card ? `rounded-md border px-3.5 py-2.5 transition-colors duration-150 ${checked ? "border-petrol bg-petrol-soft" : "border-line bg-paper hover:border-line-strong"}` : "py-1.5"} ${disabled ? "cursor-not-allowed opacity-60" : ""} ${className}`}
    >
      <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
        <input type="checkbox" name={name} value={value} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 m-0 size-5 cursor-pointer appearance-none rounded-[6px] border-[1.5px] border-line-strong bg-paper transition-colors checked:border-petrol checked:bg-petrol" />
        <Check aria-hidden size={14} strokeWidth={3} className="pointer-events-none relative text-paper opacity-0 peer-checked:opacity-100" />
      </span>
      <span className="min-w-0">
        <span className="block leading-snug">{label}</span>
        {hint && <span className="mt-0.5 block text-[0.86rem] leading-snug text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * A chip that toggles: a filter, a claim the buyer wants, an allergen to leave out. A pill; chosen it fills petrol and
 * shows a tick. On touch it is a full 44 px target.
 */
export function Chip({ on, onClick, children, count, className = "" }: { on: boolean; onClick: () => void; children: ReactNode; count?: number; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[0.88rem] font-medium transition-[background-color,border-color,color] duration-150 pointer-coarse:min-h-11 max-sm:min-h-11 ${on ? "border-petrol bg-petrol text-paper" : "border-line bg-paper text-ink hover:border-line-strong hover:bg-mist"} ${className}`}
    >
      {on && <Check aria-hidden size={14} strokeWidth={2.6} className="-ml-0.5" />}
      {children}
      {count !== undefined && <span className={`tabular text-[0.78rem] ${on ? "text-paper/80" : "text-ink-soft"}`}>{count}</span>}
    </button>
  );
}

/** A select in the field's look, with its own chevron. */
export function Select({ label, hint, error, className = "", value, onChange, children, disabled, id: givenId, name, required }: FieldShell & { value?: string; onChange?: (v: string) => void; children: ReactNode; disabled?: boolean; id?: string; name?: string; required?: boolean }) {
  const auto = useId();
  const id = givenId ?? auto;
  return (
    <Labelled id={id} label={label} hint={hint} error={error} className={className}>
      <div className="relative">
        <select id={id} name={name} required={required} value={value} disabled={disabled} onChange={onChange ? (e) => onChange(e.target.value) : undefined} aria-describedby={error || hint ? `${id}-note` : undefined} className="field appearance-none pr-10">
          {children}
        </select>
        <ChevronDown aria-hidden size={18} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-soft" />
      </div>
    </Labelled>
  );
}

// ---------- choosing one of a few ----------

export type TabOption<T extends string = string> = { id: T; label: ReactNode; count?: number };

/** A segmented control: one of a few views or filters. The chosen one is a white pill on a tinted track. */
export function Tabs<T extends string>({ options, value, onChange, label, size = "md", className = "" }: { options: readonly TabOption<T>[]; value: T; onChange: (v: T) => void; label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={`inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 ${className}`}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-[background-color,color,box-shadow] duration-150 ${size === "sm" ? "min-h-8 px-3 text-[0.82rem] pointer-coarse:min-h-11 max-sm:min-h-11" : "min-h-9 px-4 text-[0.9rem] pointer-coarse:min-h-11 max-sm:min-h-11"} ${on ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"}`}
          >
            {o.label}
            {o.count !== undefined && <span className={`tabular text-[0.78rem] ${on ? "text-ink-soft" : "text-ink-faint"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------- steps ----------

export type StepState = "done" | "current" | "stopped" | "pending" | "skipped";

/**
 * A row of steps: done (a tick), current (filled), still to come (a number), stopped by the gate (the gate's yellow).
 * On a phone it is a segmented bar with the current step named beside it.
 */
export function Steps({ steps, label }: { steps: { key: string; label: string; state: StepState }[]; label: string }) {
  const at = steps.findIndex((s) => s.state === "current" || s.state === "stopped");
  return (
    <nav aria-label={label}>
      <div className="sm:hidden" aria-hidden>
        <div className="flex gap-1">
          {steps.map((s) => (
            <span key={s.key} className={`h-1.5 flex-1 rounded-full ${s.state === "stopped" ? "bg-safety" : s.state === "current" ? "bg-petrol" : s.state === "done" ? "bg-petrol/45" : "bg-line"}`} />
          ))}
        </div>
      </div>
      <ol className="hidden items-center gap-1 sm:flex">
        {steps.map((s, i) => (
          <li key={s.key} aria-current={i === at ? "step" : undefined} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[0.8rem] font-semibold tabular ${
                s.state === "done" ? "bg-petrol-soft text-petrol" : s.state === "current" ? "bg-petrol text-paper" : s.state === "stopped" ? "bg-safety text-safety-ink" : "border border-line-strong text-ink-soft"
              }`}
            >
              {s.state === "done" ? <Check aria-hidden size={15} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className={`truncate text-[0.9rem] ${s.state === "current" || s.state === "stopped" ? "font-semibold text-ink" : s.state === "skipped" ? "text-ink-faint line-through" : "text-ink-soft"}`}>{s.label}</span>
            {i < steps.length - 1 && <span aria-hidden className={`mx-1 h-px min-w-3 flex-1 ${s.state === "done" ? "bg-petrol/40" : "bg-line"}`} />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------- lists ----------

/** One row of a list inside a card: something on the left, a title and a line under it, something on the right. */
export function ListRow({ leading, title, sub, trailing, href, onClick, className = "" }: { leading?: ReactNode; title: ReactNode; sub?: ReactNode; trailing?: ReactNode; href?: string; onClick?: () => void; className?: string }) {
  const inner = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-snug">{title}</span>
        {sub && <span className="mt-0.5 block text-[0.875rem] leading-snug text-ink-soft">{sub}</span>}
      </span>
      {trailing && <span className="shrink-0 text-right">{trailing}</span>}
    </>
  );
  const cls = `flex min-h-14 w-full items-center gap-4 px-5 py-3 text-left ${href || onClick ? "transition-colors duration-150 hover:bg-mist" : ""} ${className}`;
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={`${cls} rounded-none`}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

// ---------- price ----------

/** A price: the figure in the display face, what it is per, and a line of fine print. */
export function Price({ cents, per, note, size = "md", className = "" }: { cents: number; per?: ReactNode; note?: ReactNode; size?: "sm" | "md" | "lg"; className?: string }) {
  const fig = size === "lg" ? "text-[2.5rem]" : size === "sm" ? "text-[1.25rem]" : "text-[1.75rem]";
  return (
    <div className={className}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className={`display tabular ${fig}`}>{money(cents)}</span>
        {per && <span className="text-[0.9rem] text-ink-soft">{per}</span>}
      </p>
      {note && <p className="mt-0.5 text-[0.85rem] leading-snug text-ink-soft">{note}</p>}
    </div>
  );
}

// ---------- sheets and dialogs ----------

/**
 * A sheet: rises from the bottom edge on a phone, and is a centred dialog (or a side panel with `side="right"`) on a
 * desk. Closes on Escape and on a tap outside; the page behind does not scroll while it is open.
 */
export function Sheet({ open, onClose, title, children, side = "center", footer, className = "" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; side?: "center" | "right"; footer?: ReactNode; className?: string }) {
  const tx = useText(KIT_TEXT);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  const desk = side === "right" ? "sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-2xl" : "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl";
  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden className="fade-in absolute inset-0 bg-petrol-deep/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`sheet-up absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl bg-paper shadow-lg outline-none ${desk} ${className}`}
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" />
        <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5">
          <h2 id={titleId} className="display text-[1.35rem]">
            {title}
          </h2>
          <IconButton label={tx.close} onClick={onClose} className="-mr-2">
            <X aria-hidden size={20} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-3 border-t border-line px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">{footer}</footer>}
      </div>
    </div>
  );
}

/** A dialog is a sheet that asks one thing: the same component, named for what it is. */
export const Dialog = Sheet;

// ---------- toasts ----------

type Toast = { id: number; text: ReactNode; tone: "plain" | "good" | "bad" };
const ToastContext = createContext<{ show: (text: ReactNode, tone?: Toast["tone"]) => void } | null>(null);

/** Wrap a shell in this once; `useToast().show("Added to basket")` then confirms an action for a few seconds. */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((text: ReactNode, tone: Toast["tone"] = "plain") => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <p key={t.id} className="sheet-up pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-[0.92rem] font-medium text-paper shadow-lg">
            {t.tone === "good" && <Check aria-hidden size={16} className="shrink-0 text-lime" strokeWidth={2.5} />}
            {t.tone === "bad" && <CircleAlert aria-hidden size={16} className="shrink-0 text-safety" />}
            {t.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Outside a Toaster it does nothing, so a component can call it anywhere. */
export function useToast() {
  return useContext(ToastContext) ?? { show: () => {} };
}

// ---------- a person or a kitchen, as initials ----------

export function Avatar({ name, size = 36, tone = "petrol", className = "" }: { name: string; size?: number; tone?: "petrol" | "agent" | "dark"; className?: string }) {
  const initials = name
    .split(/[\s,]+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const look = tone === "agent" ? "bg-lavender-mid text-lavender-deep" : tone === "dark" ? "bg-paper/15 text-paper" : "bg-petrol-soft text-petrol-deep";
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${look} ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials || "?"}
    </span>
  );
}

// ---------- on or off ----------

/**
 * A switch for a setting that takes effect at once (shared or private, on or off): a pill track with a round knob,
 * the words beside it, one 44 px target. `role="switch"`; the words say the current state.
 */
export function Switch({ on, onChange, children, disabled, className = "" }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className={`inline-flex min-h-11 items-center gap-2.5 rounded-full text-left text-[0.92rem] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}>
      <span aria-hidden className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 ${on ? "bg-petrol" : "bg-line-strong"}`}>
        <span className={`size-5 rounded-full bg-paper shadow-xs transition-transform duration-150 motion-reduce:transition-none ${on ? "translate-x-4" : ""}`} />
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}
