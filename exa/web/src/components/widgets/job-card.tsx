"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, Check, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/auth/fetch";
import type { JobItem } from "@/lib/jobs/types";
import { USAGE_CAP_SENTENCE } from "@/lib/usage-cap";
import { cn } from "@/lib/utils";
import type { JobCardData, WidgetProps } from "@/lib/widgets/types";
import { WidgetError, WidgetFrame } from "./frame";

/*
 * A job in the chat: what the agent just set up, changed, listed or deleted. The card says when
 * the job really runs (the next few times, in the job's own time zone), and offers the two
 * things worth doing from here: try it now, and open it on the Jobs page.
 */

const when = (at: number, timeZone: string) => new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });

const hrefOf = (job: JobItem) => `/jobs?job=${encodeURIComponent(job.id)}`;

/** "Europe/Helsinki" as "Helsinki time", said only when it is not the zone this browser is in. */
function zoneNote(timeZone: string): string {
  let here = "";
  try {
    here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* unknown: say the zone */
  }
  return timeZone === here ? "" : ` (${timeZone.split("/").pop()?.replace(/_/g, " ")} time)`;
}

function endOf(job: JobItem): string {
  if (job.untilAt) return `Until ${when(job.untilAt, job.timeZone)}`;
  if (job.maxRuns) return `${job.maxRuns} ${job.maxRuns === 1 ? "run" : "runs"} in all`;
  return "";
}

function StatusChip({ job }: { job: JobItem }) {
  const tone = job.status === "active" ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground";
  const Icon = job.status === "active" ? Play : job.status === "paused" ? Pause : Check;
  return (
    <span className={cn("flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[0.7rem] font-medium", tone)}>
      <Icon className="size-3" />
      {job.status === "active" ? "Active" : job.status === "paused" ? "Paused" : "Finished"}
    </span>
  );
}

/** Run the job once, right away. The result comes by email and shows on the Jobs page. */
function RunNow({ job }: { job: JobItem }) {
  const [state, setState] = React.useState<"idle" | "starting" | "started">("idle");
  const run = async () => {
    setState("starting");
    try {
      const response = await api(`/api/jobs/${encodeURIComponent(job.id)}/run`, { method: "POST" });
      if (response.ok) {
        setState("started");
        toast.success("Running now", { description: "The result will be in your inbox and on the Jobs page." });
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      toast.error(response.status === 402 ? USAGE_CAP_SENTENCE : (body.error ?? "It could not be started."));
    } catch {
      toast.error("It could not be started. Check your connection.");
    }
    setState("idle");
  };
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state !== "idle"}
      className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[0.8rem] font-medium text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
    >
      {state === "started" ? <Check className="size-3.5" /> : <Play className="size-3.5" />}
      {state === "started" ? "Started" : state === "starting" ? "Starting" : "Run now"}
    </button>
  );
}

const OpenJobs = ({ href, label = "Open in Jobs" }: { href: string; label?: string }) => (
  <Link href={href} className="flex h-8 items-center gap-1 rounded-full border border-border bg-card px-3.5 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground">
    {label}
    <ArrowUpRight className="size-3.5" />
  </Link>
);

export function JobCard({ data, loading }: WidgetProps<JobCardData>) {
  if (data.action === "list") return <JobList data={data} loading={loading} />;

  const job = data.job;
  if (data.action === "deleted" && job) {
    return (
      <div className="flex w-full animate-fade items-center gap-3 rounded-2xl border border-border bg-surface/70 px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Trash2 className="size-3.5" />
        </span>
        <p className="min-w-0 text-[0.85rem] leading-snug">
          <span className="font-medium">Job deleted</span>
          <span className="text-muted-foreground">: {job.title}. Its past runs went with it.</span>
        </p>
      </div>
    );
  }

  const title = job?.title ?? data.draft?.title ?? "A new job";
  const subtitle = job ? `${job.scheduleText}${zoneNote(job.timeZone)}` : data.draft?.scheduleText;
  const runs = (data.nextRuns ?? []).slice(0, 3);
  return (
    <WidgetFrame
      icon={<CalendarClock />}
      title={title}
      subtitle={subtitle}
      loading={loading}
      stage={data.stage}
      aside={job ? <StatusChip job={job} /> : undefined}
      footerNote={job ? (data.action === "updated" ? "Job changed" : "Job set up") + ". The result of each run is emailed to you." : undefined}
    >
      {data.error ? (
        <WidgetError message={data.error} />
      ) : job ? (
        <div className="flex flex-col gap-3.5">
          <p className="text-[0.86rem] leading-relaxed text-foreground/90">{job.description}</p>
          {runs.length > 0 ? (
            <div>
              <p className="text-[0.7rem] font-medium tracking-wider text-subtle uppercase">Next runs</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {runs.map((at) => (
                  <li key={at} className="nums rounded-lg bg-surface px-2.5 py-1 text-[0.8rem] hairline">
                    {when(at, job.timeZone)}
                  </li>
                ))}
              </ul>
              {endOf(job) ? <p className="mt-1.5 text-[0.76rem] text-muted-foreground">{endOf(job)}</p> : null}
            </div>
          ) : job.status === "paused" ? (
            <p className="text-[0.8rem] text-muted-foreground">Paused. It does not run until it is resumed.</p>
          ) : job.status === "done" ? (
            <p className="text-[0.8rem] text-muted-foreground">It has no run left.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <RunNow job={job} />
            <OpenJobs href={hrefOf(job)} />
          </div>
        </div>
      ) : null}
    </WidgetFrame>
  );
}

function JobList({ data, loading }: WidgetProps<JobCardData>) {
  const jobs = data.jobs ?? [];
  return (
    <WidgetFrame icon={<CalendarClock />} title="Your jobs" subtitle={loading ? undefined : jobs.length === 0 ? "None yet" : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`} loading={loading} stage={data.stage} aside={jobs.length > 0 ? <OpenJobs href="/jobs" label="All jobs" /> : undefined}>
      {data.error ? (
        <WidgetError message={data.error} />
      ) : jobs.length === 0 ? (
        loading ? null : (
          <p className="text-[0.85rem] leading-relaxed text-muted-foreground">Nothing is scheduled. Ask for one in a chat: &ldquo;Every weekday at 8, email me the top AI news.&rdquo;</p>
        )
      ) : (
        <ul className="-mx-1.5 flex flex-col">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={hrefOf(job)} className="group/job flex items-center gap-3 rounded-xl px-1.5 py-2 transition-colors hover:bg-surface">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.88rem] font-medium">{job.title}</span>
                  <span className="block truncate text-[0.78rem] text-muted-foreground">
                    {job.scheduleText}
                    {job.status === "active" && job.nextRunAt ? ` · next ${when(job.nextRunAt, job.timeZone)}` : ""}
                  </span>
                </span>
                <StatusChip job={job} />
                <ArrowUpRight className="size-3.5 shrink-0 text-subtle transition-colors group-hover/job:text-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
