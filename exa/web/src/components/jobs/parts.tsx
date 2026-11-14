"use client";

import * as React from "react";
import { Check, CircleSlash, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobItem, JobRunStatus } from "@/lib/jobs/types";

/* Small pieces the Jobs page uses in more than one place: the marks that say how a job or a run stands, and its buttons. */

/** Where one view of the page lives in the address: the list, a job, or one of a job's runs. */
export type Place = { job?: string; run?: string };

export function hrefOf(place: Place): string {
  const query = new URLSearchParams();
  if (place.job) query.set("job", place.job);
  if (place.run) query.set("run", place.run);
  const text = query.toString();
  return text ? `/jobs?${text}` : "/jobs";
}

/** A link inside the page: it changes the address without loading the page again, and still opens in a new tab when asked to. */
export function PlaceLink({ to, go, className, children, ...rest }: { to: Place; go: (place: Place) => void } & Omit<React.ComponentProps<"a">, "href">) {
  return (
    <a
      {...rest}
      href={hrefOf(to)}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

const PILL = "inline-flex h-[1.4rem] shrink-0 items-center gap-1.5 rounded-full px-2 text-[0.68rem] font-semibold tracking-wide whitespace-nowrap";

/** How a job stands: running right now, active, paused, or finished (no run left). */
export function JobStatusPill({ job, className }: { job: Pick<JobItem, "status" | "running">; className?: string }) {
  if (job.running) {
    return (
      <span className={cn(PILL, "bg-brand-soft text-brand", className)}>
        <span className="size-1.5 animate-pulse-dot rounded-full bg-brand" />
        Running
      </span>
    );
  }
  if (job.status === "active") return <span className={cn(PILL, "bg-brand-soft text-brand", className)}>Active</span>;
  if (job.status === "paused") return <span className={cn(PILL, "bg-brass/15 text-brass", className)}>Paused</span>;
  return <span className={cn(PILL, "bg-muted text-muted-foreground", className)}>Finished</span>;
}

export const RUN_WORD: Record<JobRunStatus, string> = { running: "Running", done: "Done", failed: "Failed", skipped: "Skipped" };

/** How a run went, as a small round mark. */
export function RunMark({ status, className }: { status: JobRunStatus; className?: string }) {
  const tone =
    status === "done" ? "bg-brand-soft text-brand" : status === "running" ? "bg-brand-soft text-brand" : status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return (
    <span role="img" aria-label={RUN_WORD[status]} className={cn("flex size-6 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5", tone, className)}>
      {status === "done" ? <Check strokeWidth={2.5} /> : status === "running" ? <LoaderCircle className="animate-spin" /> : status === "failed" ? <TriangleAlert /> : <CircleSlash />}
    </span>
  );
}

/** How a run went, in a word, as a pill. */
export function RunStatusPill({ status }: { status: JobRunStatus }) {
  const tone = status === "done" || status === "running" ? "bg-brand-soft text-brand" : status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return (
    <span className={cn(PILL, tone)}>
      {status === "running" ? <span className="size-1.5 animate-pulse-dot rounded-full bg-brand" /> : null}
      {RUN_WORD[status]}
    </span>
  );
}

const BUTTON = "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[0.84rem] font-medium whitespace-nowrap transition-[background-color,opacity,transform] outline-none focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4";

export const buttonClass = {
  primary: cn(BUTTON, "bg-primary text-primary-foreground hover:opacity-90"),
  plain: cn(BUTTON, "border border-border bg-card hover:bg-muted"),
  danger: cn(BUTTON, "bg-destructive/10 text-destructive hover:bg-destructive/20"),
  quiet: cn(BUTTON, "text-muted-foreground hover:bg-muted hover:text-foreground"),
};

/** A card of the page. */
export function Card({ className, children, ...rest }: React.ComponentProps<"section">) {
  return (
    <section {...rest} className={cn("rounded-2xl border border-border bg-card/80 p-4 shadow-card backdrop-blur-sm sm:p-5", className)}>
      {children}
    </section>
  );
}

/** Something could not be loaded: say so, and offer to try again. */
export function Problem({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[0.85rem]">
      <span className="text-destructive">{children}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="h-8 rounded-full border border-border bg-card px-3 text-[0.8rem] font-medium transition-colors hover:bg-muted">
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** A grey bar that stands in for text that is still loading. */
export function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-3 animate-pulse rounded-full bg-muted", className)} />;
}
