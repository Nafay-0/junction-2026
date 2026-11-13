"use client";

import type { ReactNode } from "react";
import { Target } from "../../_ui/target";

/** Where a stage is: done, working on it, waiting for a person (safety), or the gate refused (safety). */
export type StageTone = "done" | "active" | "busy" | "safety";

/**
 * One stage of the request: a numbered marker on the dock lane at the left, and its document on the right.
 * Stages only ever get added below, so nothing above a new stage moves.
 */
export function Stage({ n, title, tone, aside, children, id }: { n: number; title: string; tone: StageTone; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={`stage-${n}`} className="relative grid grid-cols-[2.25rem_1fr] gap-x-3 pb-8 sm:grid-cols-[3rem_1fr] sm:gap-x-4">
      <div className="relative flex justify-center">
        <span aria-hidden className="absolute bottom-0 top-10 w-[3px] bg-ink/15" />
        <span className="relative mt-0.5 flex size-9 items-center justify-center bg-concrete sm:size-11">
          <Target size={34} tone={tone === "safety" ? "safety" : tone === "busy" ? "hollow" : "ink"} spin={tone === "busy"} className="text-ink" />
        </span>
      </div>
      <div className="min-w-0">
        <header className="mb-2.5 flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`stage-${n}`} className="font-display text-[1.6rem] font-bold leading-tight tracking-tight">
            <span className="sr-only">Step </span>
            <span className="mr-2 text-ink-soft tabular">{n}</span>
            <span className="sr-only">: </span>
            {title}
          </h2>
          {aside}
        </header>
        {children}
      </div>
    </section>
  );
}

/** A document: white paper with a heavy top rule. Safety documents carry the hazard band instead. */
export function Paper({ children, className = "", safety = false }: { children: ReactNode; className?: string; safety?: boolean }) {
  return (
    <div className={`bg-paper shadow-[0_1px_0_rgba(26,29,33,0.25)] ${className}`}>
      <div aria-hidden className={safety ? "hazard h-3" : "h-[3px] bg-ink"} />
      {children}
    </div>
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

export function Missing({ children }: { children: ReactNode }) {
  return <span className="border border-dashed border-ink-soft px-1.5 py-px text-[0.95rem] font-medium italic text-ink-soft">{children}</span>;
}

type ButtonProps = { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; pressed?: boolean; kind?: "primary" | "secondary" | "quiet"; type?: "button" | "submit"; className?: string };

export function Button({ children, onClick, busy, disabled, pressed, kind = "secondary", type = "button", className = "" }: ButtonProps) {
  const look =
    kind === "primary"
      ? "bg-ink text-paper hover:bg-ink-soft"
      : kind === "secondary"
        ? "border-2 border-ink bg-paper text-ink hover:bg-concrete"
        : "text-ink underline decoration-2 underline-offset-4 hover:decoration-ink-soft";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-pressed={pressed}
      className={`relative inline-flex min-h-11 items-center justify-center gap-2 px-4 text-[1.02rem] font-semibold transition-colors disabled:cursor-not-allowed ${pressed ? "" : "disabled:opacity-55"} ${look} ${className}`}
    >
      {busy && <Target size={18} tone="hollow" spin className={kind === "primary" ? "text-paper" : "text-ink"} />}
      {children}
    </button>
  );
}

export function ErrorPlate({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-start justify-between gap-3 border-l-[6px] border-ink bg-paper px-4 py-3">
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="text-ink-soft">{message}</p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} kind="secondary">
          Try again
        </Button>
      )}
    </div>
  );
}

/** A note that a value came from the kitchen's memory, not from a question. */
export function MemoryNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-[0.98rem] leading-snug">
      <span aria-hidden className="mt-[0.4em] size-2 shrink-0 rotate-45 bg-ink" />
      <span>{children}</span>
    </p>
  );
}
