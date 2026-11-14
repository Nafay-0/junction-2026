"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanData, PlanStep } from "@/lib/widgets/types";
import { Shimmer } from "./frame";

export function Plan({ data, loading }: { data: PlanData; loading?: boolean }) {
  const steps = data.steps ?? [];
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done").length;
  const allDone = total > 0 && done === total;
  const activeIndex = steps.findIndex((s) => s.status === "active");
  const currentIndex = activeIndex >= 0 ? activeIndex : allDone ? total - 1 : Math.min(done, Math.max(total - 1, 0));
  const current = steps[currentIndex];

  // Expanded while work remains, collapsed once everything is done. A click overrides that
  // until the done state flips again.
  const [override, setOverride] = React.useState<boolean | null>(null);
  const [lastAllDone, setLastAllDone] = React.useState(allDone);
  if (lastAllDone !== allDone) {
    setLastAllDone(allDone);
    setOverride(null);
  }
  const open = override ?? !allDone;
  const listId = React.useId();

  const summary =
    total === 0
      ? "Planning the steps"
      : allDone
        ? `All ${total} steps done`
        : `Step ${currentIndex + 1} of ${total}: ${current?.title ?? ""}`;

  return (
    <div className="relative w-full animate-rise overflow-hidden rounded-xl border border-border bg-surface">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-border/60" aria-hidden>
        <motion.div
          className={cn("h-full rounded-r-full", allDone ? "bg-brand/70" : "bg-brand")}
          initial={false}
          animate={{ width: total ? `${(done / total) * 100}%` : "0%" }}
          transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </div>

      <button
        type="button"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        aria-controls={listId}
        disabled={total === 0}
        className="flex min-h-11 w-full items-center gap-2.5 px-3.5 pt-3 pb-2.5 text-left outline-none focus-visible:bg-muted/60 disabled:cursor-default"
      >
        <StatusMark status={allDone ? "done" : "active"} small />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? "open" : summary}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="min-w-0 flex-1 truncate text-[0.85rem]"
          >
            {open ? (
              <span className="font-medium">Plan</span>
            ) : (
              <span className={cn(allDone ? "text-muted-foreground" : "text-foreground")}>
                {summary}
              </span>
            )}
          </motion.span>
        </AnimatePresence>
        {total > 0 ? (
          <span className="nums shrink-0 text-[0.75rem] text-muted-foreground">
            {done}/{total}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-subtle transition-transform duration-200",
            open && "rotate-180",
            total === 0 && "opacity-0",
          )}
        />
        <span className="sr-only">{open ? "Collapse plan" : "Expand plan"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={listId}
            key="list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            {total === 0 && loading ? (
              <div className="space-y-3 px-3.5 pt-1 pb-3.5" aria-hidden>
                {[0.6, 0.45, 0.7].map((w, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <Shimmer className="size-4 rounded-full" />
                    <div style={{ width: `${w * 100}%` }}>
                      <Shimmer className="h-3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ol className="relative px-3.5 pt-0.5 pb-3">
                {steps.map((step, i) => (
                  <StepRow key={`${i}-${step.title}`} step={step} index={i} last={i === total - 1} />
                ))}
              </ol>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StepRow({ step, index, last }: { step: PlanStep; index: number; last: boolean }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index, 8) * 0.04, ease: "easeOut" }}
      className="relative flex items-start gap-2.5 py-[5px]"
      aria-current={step.status === "active" ? "step" : undefined}
    >
      {!last ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-[calc(5px+1.25rem)] bottom-[-5px] left-[calc(0.5rem-0.5px)] w-px transition-colors duration-300",
            step.status === "done" ? "bg-brand/35" : "bg-border",
          )}
        />
      ) : null}
      <span className="flex h-5 items-center">
        <StatusMark status={step.status} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-[0.85rem] leading-5 transition-colors duration-300",
          step.status === "done" && "text-muted-foreground line-through decoration-subtle/70",
          step.status === "active" && "text-shimmer font-medium",
          step.status === "pending" && "text-muted-foreground",
        )}
      >
        {step.title}
      </span>
      <span className="sr-only">
        {step.status === "done" ? "(done)" : step.status === "active" ? "(in progress)" : "(pending)"}
      </span>
    </motion.li>
  );
}

function StatusMark({ status, small }: { status: PlanStep["status"]; small?: boolean }) {
  return (
    <span aria-hidden className={cn("relative flex shrink-0 items-center justify-center", small ? "size-3.5" : "size-4")}>
      <AnimatePresence mode="popLayout" initial={false}>
        {status === "done" ? (
          <motion.span
            key="done"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex size-full items-center justify-center rounded-full bg-brand text-primary-foreground dark:text-background"
          >
            <Check className={small ? "size-2.5" : "size-3"} strokeWidth={3} />
          </motion.span>
        ) : status === "active" ? (
          <motion.span
            key="active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex size-full items-center justify-center rounded-full bg-brand-soft ring-1 ring-brand/40"
          >
            <span className="size-1.5 animate-pulse-dot rounded-full bg-brand" />
          </motion.span>
        ) : (
          <motion.span
            key="pending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="size-full rounded-full border-[1.5px] border-subtle/50"
          />
        )}
      </AnimatePresence>
    </span>
  );
}
