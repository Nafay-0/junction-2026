"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFORTS, MODES, getEffort, getMode, type Effort, type ModeId } from "@/lib/agent/modes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModeIcon } from "./mode-icon";

/*
 * How the user chooses the way the work is done: a mode, from the quickest to the most capable,
 * and an effort dial for how much thought goes into each step. Nothing here says which model
 * stands behind a mode or what the dial changes inside it; the user picks a pace and a depth.
 * Only the modes the admin has given the account are offered.
 */
export function ModePicker({
  mode,
  effort,
  modes,
  onModeChange,
  onEffortChange,
}: {
  mode: ModeId;
  effort: Effort;
  /** The modes this account may use. */
  modes: ModeId[];
  onModeChange: (mode: ModeId) => void;
  onEffortChange: (effort: Effort) => void;
}) {
  const current = getMode(mode);
  const level = getEffort(effort);
  const offered = MODES.filter((m) => modes.includes(m.id));
  const dial = React.useId();

  return (
    <Popover>
      <PopoverTrigger
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8rem] whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
        aria-label={`Mode: ${current.label}. Effort: ${level.label}. Change`}
        title={`${current.label} mode, ${level.label.toLowerCase()} effort`}
      >
        <ModeIcon mode={mode} className="size-[0.95rem] shrink-0 text-brand" />
        {/* The icon alone in a narrow column, then the name, then the dial's position beside it. */}
        <span className="hidden @min-[380px]/chat:inline">{current.label}</span>
        <EffortBars effort={effort} className="hidden @min-[480px]/chat:flex" />
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[19.5rem] max-w-[calc(100vw-1.5rem)] p-0"
        // Opening lands on the mode in use, not on whichever happens to be first in the list.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
        }}
      >
        <div role="radiogroup" aria-label="Mode" className="p-1.5">
          <p className="px-2 pt-1.5 pb-1 text-[0.7rem] font-medium tracking-wide text-subtle uppercase">Mode</p>
          {offered.map((m) => {
            const chosen = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => onModeChange(m.id)}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                  chosen ? "bg-brand-soft/50" : "hover:bg-muted",
                )}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors", chosen ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground")}>
                  <ModeIcon mode={m.id} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.86rem] leading-5 font-medium">{m.label}</span>
                  <span className="block text-[0.75rem] leading-snug text-muted-foreground">{m.blurb}</span>
                </span>
                {chosen ? <Check className="size-4 shrink-0 text-brand" aria-hidden /> : null}
              </button>
            );
          })}
          {offered.length < MODES.length ? <p className="px-2 pt-1.5 pb-1 text-[0.72rem] leading-snug text-subtle">Your admin picks which modes you get.</p> : null}
        </div>

        <div className="border-t border-border px-3.5 pt-3 pb-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={dial} className="text-[0.7rem] font-medium tracking-wide text-subtle uppercase">
              Effort
            </label>
            <span className="text-[0.8rem] font-medium">{level.label}</span>
          </div>
          <input
            id={dial}
            type="range"
            min={1}
            max={EFFORTS.length}
            step={1}
            value={effort}
            onChange={(e) => onEffortChange(Number(e.target.value) as Effort)}
            aria-valuetext={level.label}
            className="effort-range mt-2 block w-full"
            style={{ "--fill": `${((effort - 1) / (EFFORTS.length - 1)) * 100}%` } as React.CSSProperties}
          />
          <div className="mt-0.5 flex justify-between">
            {EFFORTS.map((e) => (
              <button
                key={e.value}
                type="button"
                tabIndex={-1}
                onClick={() => onEffortChange(e.value)}
                className={cn("rounded-md py-1 text-[0.7rem] transition-colors", e.value === effort ? "font-medium text-foreground" : "text-subtle hover:text-muted-foreground")}
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[0.75rem] leading-snug text-muted-foreground">{level.blurb}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The dial's position at a glance: four bars, as many filled as the effort. */
function EffortBars({ effort, className }: { effort: Effort; className?: string }) {
  return (
    <span className={cn("h-3 items-end gap-[2px]", className)} aria-hidden>
      {EFFORTS.map((e) => (
        <span key={e.value} className={cn("w-[3px] rounded-full", e.value <= effort ? "bg-brand" : "bg-border")} style={{ height: `${25 + e.value * 18.75}%` }} />
      ))}
    </span>
  );
}
