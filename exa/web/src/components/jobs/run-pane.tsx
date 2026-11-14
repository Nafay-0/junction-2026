"use client";

import * as React from "react";
import { ArrowLeft, Mail, MailX } from "lucide-react";
import type { ButlerMessage } from "@/lib/agent/tools";
import { fetchRun, sayWhen, took, usd, type Answer } from "@/lib/jobs/client";
import type { JobItem, JobRunDetail } from "@/lib/jobs/types";
import { useExactLocation } from "@/lib/location";
import { useStored } from "@/lib/use-client";
import { Markdown } from "@/components/butler/markdown";
import { AssistantMessage, WorkingLine } from "@/components/butler/message";
import type { WidgetHandlers } from "@/components/butler/tool-part";
import { Bar, Card, PlaceLink, Problem, RunStatusPill, buttonClass, type Place } from "./parts";

/*
 * One run of a job, opened: when it ran, how it went, and what it produced, shown the way a chat
 * shows an answer (the steps it took, its cards, its sources). It is a record: nothing in it
 * talks back.
 */

const WHILE_RUNNING_MS = 3_000;

export function RunPane({
  runId,
  jobId,
  job,
  go,
  onJobKnown,
}: {
  runId: string;
  /** The job the address names. A link that carries only the run still works: the run says which job it belongs to. */
  jobId?: string;
  /** The job as the list has it, for its name and time zone. */
  job?: JobItem;
  go: (place: Place) => void;
  /** The run has said which job it belongs to. */
  onJobKnown: (jobId: string) => void;
}) {
  const [run, setRun] = React.useState<JobRunDetail | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [gone, setGone] = React.useState(false);

  const take = React.useCallback(
    (answer: Answer<JobRunDetail>) => {
      if (answer.ok) {
        setRun(answer.value);
        setProblem(null);
        onJobKnown(answer.value.jobId);
      } else if (answer.gone) setGone(true);
      else setProblem(answer.problem);
    },
    [onJobKnown],
  );
  const load = React.useCallback(() => void fetchRun(runId).then(take), [runId, take]);

  // A run that is still going is looked at again every few seconds, until it has its result.
  const running = run?.status === "running";
  React.useEffect(() => {
    let left = false;
    const look = () => void fetchRun(runId).then((answer) => (left ? undefined : take(answer)));
    look();
    const timer = running ? setInterval(look, WHILE_RUNNING_MS) : undefined;
    return () => {
      left = true;
      clearInterval(timer);
    };
  }, [runId, take, running]);

  // The cards are shown as they were: where the user is only matters for a map's "you are here".
  const [place] = useStored("hovi.place", "");
  const { location } = useExactLocation();
  const handlers = React.useMemo<WidgetHandlers>(() => ({ approximatePlace: place || undefined, savedLocation: location }), [place, location]);

  const back: Place = { job: jobId ?? run?.jobId };
  const backLink = (
    <PlaceLink to={back} go={go} className="-ml-1 inline-flex h-8 max-w-full items-center gap-1.5 rounded-full px-2 text-[0.82rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      <ArrowLeft className="size-4 shrink-0" />
      <span className="truncate">{job ? job.title : back.job ? "Back to the job" : "All jobs"}</span>
    </PlaceLink>
  );

  if (gone) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className="text-[0.92rem] font-medium">This run is no longer here</p>
        <p className="text-[0.85rem] text-muted-foreground">Its job was deleted, or it belongs to another account.</p>
        <PlaceLink to={{}} go={go} className={buttonClass.plain}>
          <ArrowLeft />
          All jobs
        </PlaceLink>
      </Card>
    );
  }
  if (!run) {
    return (
      <div className="space-y-4">
        {backLink}
        {problem ? (
          <Problem onRetry={load}>{problem}</Problem>
        ) : (
          <Card role="status" aria-label="Loading the run">
            <Bar className="h-5 w-1/2" />
            <Bar className="mt-4 w-3/4" />
            <Bar className="mt-2.5 w-2/3" />
          </Card>
        )}
      </div>
    );
  }

  const timeZone = job?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const answers = (run.messages as ButlerMessage[]).filter((message) => message?.role === "assistant" && Array.isArray(message.parts) && message.parts.length > 0);
  const stopped = run.status === "failed" || run.status === "skipped";

  return (
    <div className="space-y-4">
      {backLink}

      <Card>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <h2 className="min-w-0 flex-1 basis-[14rem] font-display text-[1.25rem] leading-tight sm:text-[1.4rem]">Run on {sayWhen(run.startedAt, timeZone)}</h2>
          <RunStatusPill status={run.status} />
        </div>
        {/* No dots between these: on a narrow screen they wrap, and a dot left at the end of a line reads as a mistake. */}
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.82rem] text-muted-foreground">
          <span>{run.trigger === "manual" ? "Started with Run now" : "Scheduled"}</span>
          {run.finishedAt && run.status === "done" ? <span>Took {took(run.finishedAt - run.startedAt)}</span> : null}
          {run.status === "done" ? (
            <span className="inline-flex items-center gap-1">
              {run.emailed ? <Mail className="size-3.5" /> : <MailX className="size-3.5" />}
              {run.emailed ? "Emailed to you" : "Not emailed"}
            </span>
          ) : null}
          {run.costUsd !== undefined && (run.status === "done" || run.status === "failed") ? <span>{usd(run.costUsd)}</span> : null}
        </p>
        {stopped ? (
          <p role="status" className="mt-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-[0.86rem] leading-snug text-destructive">
            {run.error || (run.status === "failed" ? "This run did not finish." : "This run was skipped.")}
          </p>
        ) : null}
        {problem ? (
          <div className="mt-3">
            <Problem onRetry={load}>{problem}</Problem>
          </div>
        ) : null}
      </Card>

      {run.status === "running" ? (
        <Card>
          <WorkingLine label="Working on it" />
          <p className="mt-1 text-[0.84rem] text-muted-foreground">The result shows here when it&apos;s done. You can leave this page: it carries on.</p>
        </Card>
      ) : answers.length > 0 ? (
        <Card className="px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7">
            {answers.map((message) => (
              <AssistantMessage key={message.id} message={message} active={false} handlers={handlers} />
            ))}
          </div>
        </Card>
      ) : run.output?.trim() ? (
        <Card className="px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto w-full max-w-[760px]">
            <Markdown>{run.output}</Markdown>
          </div>
        </Card>
      ) : stopped ? null : (
        <Card>
          <p className="text-[0.86rem] text-muted-foreground">This run finished without writing anything.</p>
        </Card>
      )}
    </div>
  );
}
