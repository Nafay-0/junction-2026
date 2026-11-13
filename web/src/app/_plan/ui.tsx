"use client";

import type { ReactNode } from "react";
import { Target } from "../_ui/target";

/**
 * Small building blocks of the plan sheet, kept in this folder so the kitchen portal can mount the planner without
 * depending on the console's files. Same tokens as the rest of Dock: paper for documents, ink, and safety yellow
 * only where a person decides.
 */

export function Sheet({ children, safety = false, className = "" }: { children: ReactNode; safety?: boolean; className?: string }) {
  return (
    <section className={`bg-paper shadow-[0_1px_0_rgba(26,29,33,0.25)] ${className}`}>
      <div aria-hidden className={safety ? "hazard h-3" : "h-[3px] bg-ink"} />
      {children}
    </section>
  );
}

type ButtonProps = { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; kind?: "primary" | "secondary" | "quiet" | "safety"; type?: "button" | "submit"; className?: string; title?: string };

export function Btn({ children, onClick, busy, disabled, kind = "secondary", type = "button", className = "", title }: ButtonProps) {
  const look =
    kind === "primary"
      ? "bg-ink text-paper hover:bg-ink-soft"
      : kind === "safety"
        ? "bg-safety text-safety-ink border-2 border-ink hover:brightness-95"
        : kind === "secondary"
          ? "border-2 border-ink bg-paper text-ink hover:bg-concrete"
          : "text-ink underline decoration-2 underline-offset-4 hover:decoration-ink-soft";
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`relative inline-flex min-h-11 items-center justify-center gap-2 px-3.5 text-[1rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${look} ${className}`}
    >
      {busy && <Target size={18} tone="hollow" spin className={kind === "primary" ? "text-paper" : "text-ink"} />}
      {children}
    </button>
  );
}

export function Chip({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "ok" | "warn" | "muted"; title?: string }) {
  const look = tone === "warn" ? "bg-safety text-safety-ink border-ink" : tone === "ok" ? "border-ink text-ink" : tone === "muted" ? "border-ink/30 text-ink-soft" : "border-ink/60 text-ink";
  return (
    <span title={title} className={`inline-flex items-center gap-1 border px-1.5 py-px text-[0.8rem] font-semibold leading-5 ${look}`}>
      {children}
    </span>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[0.8rem] font-medium leading-tight text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-[1.05rem] font-semibold leading-snug">{children}</dd>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-ink-soft">
      <Target size={20} tone="hollow" spin className="text-ink" /> {label}
    </p>
  );
}
