"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarClock, MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { ago, elsewhere, fetchJobs, sayWhen, zoneName, type Answer } from "@/lib/jobs/client";
import type { JobItem } from "@/lib/jobs/types";
import { JobPane } from "./job-pane";
import { Bar, Card, JobStatusPill, PlaceLink, Problem, RUN_WORD, buttonClass, hrefOf, type Place } from "./parts";
import { RunPane } from "./run-pane";

/*
 * The Jobs page. Jobs are made in a chat; here the account sees them, opens one to read and
 * change what it does, pauses or deletes it, runs it once by hand, and reads what each run
 * produced.
 *
 * What is open lives in the address (?job=<id>, and &run=<id> for one run), so a link from an
 * email lands on the right run and Back steps out of it. Where there is room the list stays
 * beside what is open; where there is not, it gives way to it. "Room" is the width of the page's
 * own column (`@container/jobs` in the shell), which in the desktop app shrinks when the live
 * browser opens beside it.
 */

/** How often the list is read again: quickly while a run is in progress, now and then otherwise. */
const WHILE_RUNNING_MS = 4_000;
const AT_REST_MS = 45_000;

export function JobsScreen() {
  const params = useSearchParams();
  const jobId = params.get("job") ?? undefined;
  const runId = params.get("run") ?? undefined;
  const opened = Boolean(jobId || runId);

  const [jobs, setJobs] = React.useState<JobItem[] | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  const take = React.useCallback((answer: Answer<JobItem[]>) => {
    if (answer.ok) {
      setJobs(answer.value);
      setProblem(null);
    } else setProblem(answer.problem);
  }, []);
  const load = React.useCallback(() => void fetchJobs().then(take), [take]);

  const anyRunning = jobs?.some((job) => job.running) ?? false;
  React.useEffect(() => {
    let left = false;
    const look = () => void fetchJobs().then((answer) => (left ? undefined : take(answer)));
    look();
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") look();
      },
      anyRunning ? WHILE_RUNNING_MS : AT_REST_MS,
    );
    window.addEventListener("focus", look);
    return () => {
      left = true;
      clearInterval(timer);
      window.removeEventListener("focus", look);
    };
  }, [take, anyRunning]);

  /** Go to another view of the page. The address changes, the page does not load again, and Back comes back. */
  const go = React.useCallback((place: Place) => {
    window.history.pushState(null, "", hrefOf(place));
    // The page scrolls as a whole on the web, and inside its own column in the desktop app.
    window.scrollTo({ top: 0 });
    document.querySelector("[data-jobs-scroll]")?.scrollTo({ top: 0 });
  }, []);

  /** A job changed in the open pane: the list shows it at once. */
  const onJob = React.useCallback((job: JobItem) => setJobs((list) => (list ? (list.some((j) => j.id === job.id) ? list.map((j) => (j.id === job.id ? job : j)) : [job, ...list]) : list)), []);
  const onDeleted = React.useCallback(
    (id: string) => {
      setJobs((list) => list?.filter((j) => j.id !== id) ?? list);
      window.history.replaceState(null, "", hrefOf({}));
    },
    [],
  );

  /** A link that carried only a run: once the run says which job it is, the address says so too, without a new history entry. */
  const onJobKnown = React.useCallback((id: string) => {
    const now = new URLSearchParams(window.location.search);
    if (now.get("job") || !now.get("run")) return;
    window.history.replaceState(null, "", hrefOf({ job: id, run: now.get("run") ?? undefined }));
  }, []);

  const selected = jobs?.find((job) => job.id === jobId);

  return (
    <div>
      <div className={cn(opened && "hidden @min-[60rem]/jobs:block")}>
        <h1 className="font-display text-[1.75rem] leading-[1.15] sm:text-[2.1rem]">Jobs</h1>
        <p className="mt-1.5 max-w-[40rem] text-[0.9rem] text-muted-foreground">
          Things {APP_NAME} does for you on a schedule. Each result is emailed to you and kept here.
        </p>
      </div>

      {jobs === null ? (
        <div className="mt-6">{problem ? <Problem onRetry={load}>{problem}</Problem> : <ListSkeleton />}</div>
      ) : jobs.length === 0 && !opened ? (
        <NoJobs />
      ) : (
        <div className="@min-[60rem]/jobs:mt-6 @min-[60rem]/jobs:grid @min-[60rem]/jobs:grid-cols-[minmax(0,21.5rem)_minmax(0,1fr)] @min-[60rem]/jobs:items-start @min-[60rem]/jobs:gap-6">
          <nav aria-label="Your jobs" className={cn("mt-6 @min-[60rem]/jobs:sticky @min-[60rem]/jobs:top-20 @min-[60rem]/jobs:mt-0", opened && "hidden @min-[60rem]/jobs:block")}>
            {problem ? (
              <div className="mb-3">
                <Problem onRetry={load}>{problem}</Problem>
              </div>
            ) : null}
            <ul className="space-y-2">
              {jobs.map((job) => (
                <li key={job.id}>
                  <JobRow job={job} active={job.id === jobId} go={go} />
                </li>
              ))}
            </ul>
            <p className="mt-4 px-1 text-[0.78rem] leading-snug text-subtle">
              To add a job, ask in a chat. For example: &quot;Every weekday at 8, email me the top AI news.&quot;
            </p>
          </nav>

          <div className={cn("min-w-0", !opened && "hidden @min-[60rem]/jobs:block")}>
            {runId ? (
              <RunPane key={runId} runId={runId} jobId={jobId} job={selected} go={go} onJobKnown={onJobKnown} />
            ) : jobId ? (
              <JobPane key={jobId} jobId={jobId} initial={selected} go={go} onJob={onJob} onDeleted={onDeleted} />
            ) : (
              <Card className="flex min-h-[16rem] flex-col items-center justify-center gap-2 text-center">
                <CalendarClock className="size-6 text-subtle" />
                <p className="text-[0.9rem] font-medium">Pick a job</p>
                <p className="max-w-[24rem] text-[0.82rem] leading-snug text-muted-foreground">Open one to see what it does, change its instructions, run it now, or read what each run found.</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** When the job runs next, in a few words. */
function nextLine(job: JobItem): string {
  if (job.status === "paused") return "Paused";
  if (job.status === "done" || !job.nextRunAt) return "No runs left";
  return `Next: ${sayWhen(job.nextRunAt, job.timeZone)}${elsewhere(job.timeZone) ? ` (${zoneName(job.timeZone)})` : ""}`;
}

/** How the latest run went, in a few words. */
function lastLine(job: JobItem): string {
  if (!job.lastRun) return "Not run yet";
  if (job.lastRun.status === "running") return "Running now";
  return `Last run: ${RUN_WORD[job.lastRun.status].toLowerCase()}, ${ago(job.lastRun.startedAt)}`;
}

function JobRow({ job, active, go }: { job: JobItem; active: boolean; go: (place: Place) => void }) {
  const failed = job.lastRun?.status === "failed";
  return (
    <PlaceLink
      to={{ job: job.id }}
      go={go}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-2xl border p-3.5 shadow-card transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        active ? "border-brand/50 bg-card" : "border-border bg-card/70 hover:bg-card",
      )}
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[0.92rem] leading-snug font-medium [overflow-wrap:anywhere]">{job.title}</span>
        <JobStatusPill job={job} className="mt-px" />
      </span>
      <span className="mt-1 block truncate text-[0.82rem] text-muted-foreground">{job.scheduleText}</span>
      <span className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[0.76rem] leading-snug text-subtle">
        <span>{nextLine(job)}</span>
        <span aria-hidden>·</span>
        <span className={cn(failed && "text-destructive")}>{lastLine(job)}</span>
      </span>
    </PlaceLink>
  );
}

/** Nothing has been set up yet: say what a job is and how one is made. */
function NoJobs() {
  return (
    <Card className="mx-auto mt-8 flex max-w-[34rem] flex-col items-center gap-2 px-6 py-10 text-center sm:py-12">
      <span className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <CalendarClock className="size-5" />
      </span>
      <h2 className="text-[1.05rem] font-medium">No jobs yet</h2>
      <p className="max-w-[26rem] text-[0.88rem] leading-relaxed text-muted-foreground">
        A job is something {APP_NAME} looks up for you on a schedule and emails you. You set one up by asking in a chat.
      </p>
      <p className="mt-2 w-full rounded-xl bg-surface px-4 py-3 text-left text-[0.86rem] leading-snug hairline">
        <span className="block text-[0.7rem] font-semibold tracking-wider text-subtle uppercase">Try asking</span>
        <span className="mt-1 block">Every weekday at 8, email me the top AI news.</span>
      </p>
      <Link href="/" className={cn(buttonClass.primary, "mt-4 px-4")}>
        <MessageSquarePlus />
        Start a chat
      </Link>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="max-w-[21.5rem] space-y-2" aria-label="Loading your jobs" role="status">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl border border-border bg-card/70 p-3.5">
          <Bar className="w-2/3" />
          <Bar className="mt-2.5 w-1/2" />
          <Bar className="mt-3 h-2.5 w-3/4" />
        </div>
      ))}
    </div>
  );
}
