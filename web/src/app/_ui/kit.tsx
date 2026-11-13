"use client";

import type { ReactNode } from "react";

/**
 * Dock's core components (see web/docs/DESIGN.md). Square, flat, petrol for structure, lime for the one main action,
 * lavender for the agent, yellow and black only at the gate. Every surface on the customer side is built from these.
 */

// ---------- buttons ----------

export type ButtonKind = "go" | "primary" | "secondary" | "quiet" | "safety" | "dark" | "ghost-dark";
export type ButtonSize = "sm" | "md" | "lg";

const LOOK: Record<ButtonKind, string> = {
  // The one main action in view: lime with charcoal text.
  go: "bg-lime text-ink hover:bg-lime-hover active:translate-y-px",
  // Strong but not the main action: solid petrol.
  primary: "bg-petrol text-paper hover:bg-petrol-deep active:translate-y-px",
  secondary: "border-2 border-petrol bg-paper text-petrol hover:bg-petrol-soft",
  quiet: "text-petrol underline decoration-2 underline-offset-4 hover:decoration-petrol-deep hover:text-petrol-deep",
  // Gate only: a person decides.
  safety: "bg-safety text-safety-ink border-2 border-safety-ink hover:brightness-95",
  dark: "bg-ink text-paper hover:bg-petrol-deep",
  "ghost-dark": "border-2 border-paper/70 text-paper hover:bg-paper/10",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-[0.92rem]",
  md: "min-h-11 px-4 text-[1rem]",
  lg: "min-h-14 px-6 text-[1.12rem]",
};

export function buttonClass(kind: ButtonKind = "secondary", size: ButtonSize = "md", extra = ""): string {
  return `relative inline-flex items-center justify-center gap-2 font-semibold leading-tight transition-colors disabled:cursor-not-allowed ${kind === "quiet" ? "min-h-11 px-0" : SIZE[size]} ${LOOK[kind]} ${extra}`;
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

// ---------- working, waiting ----------

/** A square that turns: working. Not the crash-test mark, which belongs to the gate. */
export function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={`inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      <span className="spin block size-full border-[3px] border-current border-r-transparent" style={{ animationDuration: "0.9s" }} />
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
  return <div aria-label={label} role={label ? "status" : undefined} className={`animate-pulse bg-concrete-deep/60 ${className}`} />;
}

// ---------- surfaces ----------

/**
 * A document or a panel: white paper with a petrol top rule.
 *   tone "agent"  lavender: the agent remembered, inferred or wrote this
 *   tone "gate"   the hazard band: a person must act, or the gate refused (gate only)
 */
export function Plate({ children, className = "", tone = "paper", as: As = "div", rule = true }: { children: ReactNode; className?: string; tone?: "paper" | "agent" | "gate"; as?: "div" | "section" | "article"; rule?: boolean }) {
  return (
    <As className={`${tone === "agent" ? "bg-lavender" : "bg-paper"} ${className}`}>
      {rule && <div aria-hidden className={tone === "gate" ? "hazard h-3" : tone === "agent" ? "h-[3px] bg-lavender-deep" : "h-[3px] bg-petrol"} />}
      {children}
    </As>
  );
}

/** A labelled field, as on a waybill: small label, the value under it. */
export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[0.8rem] font-medium leading-tight text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-[1.05rem] font-semibold leading-snug">{children}</dd>
    </div>
  );
}

/** A value the data does not have: said plainly, never left blank. */
export function Missing({ children }: { children: ReactNode }) {
  return <span className="border border-dashed border-ink-soft/70 px-1.5 py-px text-[0.92rem] font-medium italic text-ink-soft">{children}</span>;
}

/** A small outlined label: a dietary claim, a certificate, a status word. */
export function Tag({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "petrol" | "agent" | "muted" | "safety"; title?: string }) {
  const look =
    tone === "petrol"
      ? "border-petrol bg-petrol text-paper"
      : tone === "agent"
        ? "border-lavender-deep/40 bg-lavender text-lavender-deep"
        : tone === "muted"
          ? "border-line text-ink-soft"
          : tone === "safety"
            ? "border-safety-ink bg-safety text-safety-ink"
            : "border-petrol/40 text-petrol";
  return (
    <span title={title} className={`inline-flex items-center gap-1 border px-1.5 text-[0.78rem] font-semibold leading-[1.35rem] ${look}`}>
      {children}
    </span>
  );
}

/** Section heading in the display face, with an optional note or action on the right. */
export function SectionTitle({ id, children, aside, className = "" }: { id?: string; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 ${className}`}>
      <h2 id={id} className="display text-[1.75rem] text-ink">
        {children}
      </h2>
      {aside && <div className="text-[0.92rem] text-ink-soft">{aside}</div>}
    </div>
  );
}

/** Something went wrong: what happened and how to fix it. No apology. */
export function ErrorPlate({ title, message, onRetry, extra }: { title: string; message: string; onRetry?: () => void; extra?: { label: string; onClick: () => void } | false | undefined }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-start justify-between gap-3 border-l-[6px] border-petrol bg-paper px-4 py-3">
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="text-ink-soft">{message}</p>
      </div>
      {(onRetry || extra) && (
        <div className="flex flex-wrap gap-3">
          {onRetry && (
            <Button onClick={onRetry} kind="secondary">
              Try again
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
    <div className="flex flex-wrap items-start gap-4 bg-paper p-5">
      {glyph && <div className="shrink-0 text-petrol">{glyph}</div>}
      <div className="min-w-0 flex-1">
        <p className="text-[1.08rem] font-semibold">{title}</p>
        {children && <div className="mt-1 max-w-[62ch] leading-snug text-ink-soft">{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-3">{action}</div>}
      </div>
    </div>
  );
}

/** A note that a value came from the kitchen's memory or the agent, not from a question: lavender diamond. */
export function AgentNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-[0.98rem] leading-snug">
      <span aria-hidden className="mt-[0.45em] size-2 shrink-0 rotate-45 bg-lavender-deep" />
      <span>{children}</span>
    </p>
  );
}

/** Keyboard key, for shortcuts shown next to a control. */
export function Kbd({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <kbd className={`inline-flex min-w-6 items-center justify-center border px-1 font-sans text-[0.75rem] font-semibold leading-5 ${dark ? "border-paper/40 text-paper/85" : "border-line bg-mist text-ink-soft"}`}>{children}</kbd>;
}
