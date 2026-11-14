"use client";

import * as React from "react";
import { ArrowLeft, CalendarClock, ChevronRight, LoaderCircle, Mail, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { getEffort, getMode, cleanEffort, isMode } from "@/lib/agent/modes";
import { changeJob, elsewhere, fetchJob, removeJob, runJobNow, sayWhen, took, usd, zoneName, type Answer } from "@/lib/jobs/client";
import type { JobDetail, JobItem, JobRunItem } from "@/lib/jobs/types";
import { ModeIcon } from "@/components/butler/mode-icon";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bar, Card, JobStatusPill, PlaceLink, Problem, RunMark, RUN_WORD, buttonClass, type Place } from "./parts";

/*
 * One job, opened: what it is called, when it runs, what it is for and what each run is told to
 * do, and its runs. The name, the purpose and the instructions can be changed here; when it runs
 * cannot, because working out a schedule from what someone means is the agent's part, in a chat.
 */

const WHILE_RUNNING_MS = 3_500;
const AT_REST_MS = 45_000;

export function JobPane({
  jobId,
  initial,
  go,
  onJob,
  onDeleted,
}: {
  jobId: string;
  /** The job as the list has it, so the pane has something to show before its own answer arrives. */
  initial?: JobItem;
  go: (place: Place) => void;
  /** The job changed here: tell the list. */
  onJob: (job: JobItem) => void;
  onDeleted: (id: string) => void;
}) {
  const [job, setJob] = React.useState<JobItem | null>(initial ?? null);
  const [runs, setRuns] = React.useState<JobRunItem[] | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [gone, setGone] = React.useState(false);
  const [busy, setBusy] = React.useState<"run" | "pause" | "delete" | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const take = React.useCallback(
    (answer: Answer<JobDetail>) => {
      if (answer.ok) {
        setJob(answer.value.job);
        setRuns(answer.value.runs);
        setProblem(null);
        onJob(answer.value.job);
      } else if (answer.gone) setGone(true);
      else setProblem(answer.problem);
    },
    [onJob],
  );
  const load = React.useCallback(() => void fetchJob(jobId).then(take), [jobId, take]);

  // While a run is in progress the pane looks again every few seconds, so it turns to Done by itself.
  const live = Boolean(job?.running) || (runs?.some((run) => run.status === "running") ?? false);
  React.useEffect(() => {
    let left = false;
    const look = () => void fetchJob(jobId).then((answer) => (left ? undefined : take(answer)));
    look();
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") look();
      },
      live ? WHILE_RUNNING_MS : AT_REST_MS,
    );
    return () => {
      left = true;
      clearInterval(timer);
    };
  }, [jobId, take, live]);

  if (gone) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className="text-[0.92rem] font-medium">This job is no longer here</p>
        <p className="text-[0.85rem] text-muted-foreground">It was deleted, or it belongs to another account.</p>
        <PlaceLink to={{}} go={go} className={buttonClass.plain}>
          <ArrowLeft />
          All jobs
        </PlaceLink>
      </Card>
    );
  }
  if (!job) {
    return problem ? (
      <Problem onRetry={load}>{problem}</Problem>
    ) : (
      <Card role="status" aria-label="Loading the job">
        <Bar className="h-5 w-1/2" />
        <Bar className="mt-4 w-3/4" />
        <Bar className="mt-2.5 w-2/3" />
      </Card>
    );
  }

  const save = async (change: { title?: string; description?: string; prompt?: string }): Promise<string | null> => {
    const answer = await changeJob(job.id, change);
    if (!answer.ok) return answer.problem;
    setJob(answer.value);
    onJob(answer.value);
    return null;
  };

  const runNow = async () => {
    setBusy("run");
    const answer = await runJobNow(job.id);
    setBusy(null);
    if (!answer.ok) {
      toast.error(answer.problem);
      return;
    }
    // The new run shows at once; the next look fills in the rest.
    const started: JobRunItem = { id: answer.value, jobId: job.id, trigger: "manual", status: "running", startedAt: Date.now(), summary: "", emailed: false };
    setRuns((list) => [started, ...(list ?? []).filter((run) => run.id !== started.id)]);
    const running = { ...job, running: true, lastRun: { id: started.id, status: "running" as const, startedAt: started.startedAt } };
    setJob(running);
    onJob(running);
    toast("Running now", { description: "The result shows here when it's done, and goes to your inbox." });
  };

  const setStatus = async (status: "active" | "paused") => {
    setBusy("pause");
    const answer = await changeJob(job.id, { status });
    setBusy(null);
    if (!answer.ok) {
      toast.error(answer.problem);
      return;
    }
    setJob(answer.value);
    onJob(answer.value);
  };

  const remove = async () => {
    setBusy("delete");
    const answer = await removeJob(job.id);
    setBusy(null);
    if (!answer.ok && !answer.gone) {
      toast.error(answer.problem);
      return;
    }
    setConfirming(false);
    toast("Job deleted");
    onDeleted(job.id);
  };

  const mode = getMode(job.mode);
  const effort = getEffort(cleanEffort(job.effort));

  return (
    <div className="space-y-4">
      <PlaceLink to={{}} go={go} className="-ml-1 inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[0.82rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground @min-[60rem]/jobs:hidden">
        <ArrowLeft className="size-4" />
        All jobs
      </PlaceLink>

      <Card>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-[14rem]">
            <TitleField value={job.title} onSave={(title) => save({ title })} />
          </div>
          <JobStatusPill job={job} className="mt-1.5" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void runNow()} disabled={busy !== null || job.running} className={buttonClass.primary}>
            {busy === "run" || job.running ? <LoaderCircle className="animate-spin" /> : <Play />}
            {job.running ? "Running" : "Run now"}
          </button>
          {job.status === "active" ? (
            <button type="button" onClick={() => void setStatus("paused")} disabled={busy !== null} className={buttonClass.plain}>
              <Pause />
              Pause
            </button>
          ) : job.status === "paused" ? (
            <button type="button" onClick={() => void setStatus("active")} disabled={busy !== null} className={buttonClass.plain}>
              <Play />
              Resume
            </button>
          ) : null}
          <button type="button" onClick={() => setConfirming(true)} disabled={busy !== null} className={cn(buttonClass.danger, "sm:ml-auto")}>
            <Trash2 />
            Delete
          </button>
        </div>
      </Card>

      <Card aria-labelledby="job-when">
        <h3 id="job-when" className="flex items-center gap-2 text-[0.78rem] font-semibold tracking-wider text-subtle uppercase">
          <CalendarClock className="size-3.5" />
          When it runs
        </h3>
        <p className="mt-2 text-[1.05rem] leading-snug font-medium [overflow-wrap:anywhere]">{job.scheduleText}</p>
        <ul className="mt-2 space-y-1 text-[0.86rem] leading-snug text-muted-foreground">
          <li>{nextText(job)}</li>
          {endText(job) ? <li>{endText(job)}</li> : null}
          {elsewhere(job.timeZone) ? (
            <li>
              Times are in {zoneName(job.timeZone)} ({job.timeZone}).
            </li>
          ) : null}
          <li className="flex flex-wrap items-center gap-x-1.5">
            <span>Runs in</span>
            <span className="inline-flex items-center gap-1 text-foreground/85">
              <ModeIcon mode={isMode(job.mode) ? job.mode : mode.id} className="size-3.5" />
              {mode.label} mode
            </span>
            <span>with {effort.label.toLowerCase()} effort.</span>
          </li>
        </ul>
        <p className="mt-3 border-t border-border/70 pt-3 text-[0.8rem] text-subtle">To change when it runs, ask in a chat.</p>
      </Card>

      <Card>
        <TextField label={"What it's for"} value={job.description} empty="No description." rows={3} onSave={(description) => save({ description })} />
      </Card>

      <Card>
        <TextField
          label="Instructions"
          hint={`What each run is told to do. ${APP_NAME} wrote this when the job was made.`}
          value={job.prompt}
          empty="No instructions."
          rows={9}
          required
          onSave={(prompt) => save({ prompt })}
        />
      </Card>

      <Card aria-labelledby="job-runs">
        <div className="flex items-center justify-between gap-3">
          <h3 id="job-runs" className="text-[0.78rem] font-semibold tracking-wider text-subtle uppercase">
            Runs
          </h3>
          {runs && runs.length > 0 ? <span className="text-[0.76rem] text-subtle">{runs.length === 1 ? "1 run" : `${runs.length} runs`}, newest first</span> : null}
        </div>
        {problem ? (
          <div className="mt-3">
            <Problem onRetry={load}>{problem}</Problem>
          </div>
        ) : null}
        {runs === null ? (
          <div className="mt-3 space-y-2.5" role="status" aria-label="Loading the runs">
            <Bar className="w-2/3" />
            <Bar className="w-1/2" />
          </div>
        ) : runs.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border bg-surface/50 px-4 py-6 text-center text-[0.84rem] leading-snug text-muted-foreground">
            It has not run yet. Press Run now to try it.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/70">
            {runs.map((run) => (
              <li key={run.id}>
                <RunRow run={run} timeZone={job.timeZone} go={go} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={confirming} onOpenChange={(open) => (busy === "delete" ? undefined : setConfirming(open))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-[1.2rem]">Delete this job?</DialogTitle>
            <DialogDescription>
              &quot;{job.title}&quot; will stop running, and {runs && runs.length > 0 ? (runs.length === 1 ? "its one saved run" : `its ${runs.length} saved runs`) : "anything it has saved"} will be deleted with it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy === "delete"} className={buttonClass.plain}>
              Keep it
            </button>
            <button type="button" onClick={() => void remove()} disabled={busy === "delete"} className={buttonClass.danger}>
              {busy === "delete" ? <LoaderCircle className="animate-spin" /> : null}
              Delete job
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** When it runs next, as a sentence. */
function nextText(job: JobItem): string {
  if (job.status === "done" || !job.nextRunAt) return job.runCount > 0 ? "It has no runs left." : "It has no run ahead.";
  if (job.status === "paused") return "Paused. Resume it and it picks up at its next time.";
  return `Next run: ${sayWhen(job.nextRunAt, job.timeZone)}.`;
}

/** When a repeating job stops, as a sentence. Nothing for a one-time job. */
function endText(job: JobItem): string | null {
  if (job.schedule.kind === "once") return null;
  const until = job.untilAt ? sayWhen(job.untilAt, job.timeZone) : null;
  const soFar = job.runCount === 1 ? "1 so far" : `${job.runCount} so far`;
  if (until && job.maxRuns) return `Ends on ${until}, or after ${job.maxRuns} runs (${soFar}), whichever comes first.`;
  if (until) return `Ends on ${until}.`;
  if (job.maxRuns) return `Ends after ${job.maxRuns === 1 ? "1 run" : `${job.maxRuns} runs`} (${soFar}).`;
  return job.status === "done" ? null : "Keeps going until you pause or delete it.";
}

function RunRow({ run, timeZone, go }: { run: JobRunItem; timeZone: string; go: (place: Place) => void }) {
  const note = run.status === "failed" || run.status === "skipped" ? run.error || (run.status === "failed" ? "It did not finish." : "It did not run.") : run.status === "running" ? "Working on it." : run.summary || "No text in the result.";
  return (
    <PlaceLink
      to={{ job: run.jobId, run: run.id }}
      go={go}
      className="group/run -mx-2 flex items-start gap-3 rounded-xl px-2 py-3 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <RunMark status={run.status} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.86rem]">
          <span className="font-medium">{sayWhen(run.startedAt, timeZone)}</span>
          <span className="text-subtle">{run.trigger === "manual" ? "Run now" : "Scheduled"}</span>
          <span className={cn("text-subtle", run.status === "failed" && "text-destructive")}>{RUN_WORD[run.status]}</span>
        </span>
        <span className={cn("mt-0.5 line-clamp-2 text-[0.82rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]", run.status === "failed" && "text-destructive/90")}>{note}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.74rem] text-subtle">
          {run.finishedAt && run.status === "done" ? <span>Took {took(run.finishedAt - run.startedAt)}</span> : null}
          {run.emailed ? (
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3" />
              Emailed
            </span>
          ) : run.status === "done" ? (
            <span>Not emailed</span>
          ) : null}
          {run.costUsd !== undefined && (run.status === "done" || run.status === "failed") ? <span>{usd(run.costUsd)}</span> : null}
        </span>
      </span>
      <ChevronRight className="mt-1 size-4 shrink-0 text-subtle transition-transform group-hover/run:translate-x-0.5" />
    </PlaceLink>
  );
}

const FIELD = "w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-[0.9rem] leading-relaxed outline-none transition-[border-color,box-shadow] placeholder:text-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

/** What editing a field needs: the draft, whether it is being saved, and what went wrong. `onSave` answers null when it worked. */
function useEdit(value: string, onSave: (next: string) => Promise<string | null>, required: boolean) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const start = () => {
    setDraft(value);
    setProblem(null);
    setEditing(true);
  };
  const cancel = () => {
    if (saving) return;
    setEditing(false);
    setProblem(null);
  };
  const submit = async () => {
    const next = draft.trim();
    if (saving) return;
    if (required && !next) {
      setProblem("This cannot be empty.");
      return;
    }
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const wrong = await onSave(next);
    setSaving(false);
    if (wrong) setProblem(wrong);
    else setEditing(false);
  };
  return { editing, draft, setDraft, saving, problem, start, cancel, submit };
}

function SaveRow({ saving, problem, onCancel }: { saving: boolean; problem: string | null; onCancel: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="submit" disabled={saving} className={cn(buttonClass.primary, "h-8 px-3.5 text-[0.82rem]")}>
        {saving ? <LoaderCircle className="animate-spin" /> : null}
        Save
      </button>
      <button type="button" onClick={onCancel} disabled={saving} className={cn(buttonClass.plain, "h-8 px-3.5 text-[0.82rem]")}>
        Cancel
      </button>
      {problem ? (
        <span role="alert" className="text-[0.8rem] text-destructive">
          {problem}
        </span>
      ) : null}
    </div>
  );
}

/** The job's name, changed in place. */
function TitleField({ value, onSave }: { value: string; onSave: (next: string) => Promise<string | null> }) {
  const edit = useEdit(value, onSave, true);
  if (!edit.editing) {
    return (
      <div className="flex items-start gap-1.5">
        <h2 className="min-w-0 font-display text-[1.35rem] leading-tight [overflow-wrap:anywhere] sm:text-[1.5rem]">{value}</h2>
        <button type="button" onClick={edit.start} aria-label="Rename the job" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
          <Pencil className="size-3.5" />
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void edit.submit();
      }}
    >
      <input
        autoFocus
        aria-label="Name of the job"
        value={edit.draft}
        maxLength={120}
        onChange={(event) => edit.setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") edit.cancel();
        }}
        className={cn(FIELD, "h-10 py-0 text-[1rem] font-medium")}
      />
      <SaveRow saving={edit.saving} problem={edit.problem} onCancel={edit.cancel} />
    </form>
  );
}

/** A longer piece of the job's text, with its label and an Edit button: read as written, changed in a box. */
function TextField({
  label,
  hint,
  value,
  empty,
  rows,
  required = false,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string;
  /** What to say when there is no text. */
  empty: string;
  rows: number;
  required?: boolean;
  onSave: (next: string) => Promise<string | null>;
}) {
  const edit = useEdit(value, onSave, required);
  const id = React.useId();
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 id={id} className="text-[0.78rem] font-semibold tracking-wider text-subtle uppercase">
          {label}
        </h3>
        {edit.editing ? null : (
          <button type="button" onClick={edit.start} aria-label={`Edit: ${label}`} className="-my-1 flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[0.8rem] text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
            <Pencil className="size-3.5" />
            Edit
          </button>
        )}
      </div>
      {hint ? <p className="mt-1 text-[0.78rem] text-subtle">{hint}</p> : null}
      {edit.editing ? (
        <form
          className="mt-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void edit.submit();
          }}
        >
          <textarea
            autoFocus
            aria-labelledby={id}
            value={edit.draft}
            rows={rows}
            onChange={(event) => edit.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") edit.cancel();
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void edit.submit();
              }
            }}
            className={cn(FIELD, "min-h-[5rem] resize-y")}
          />
          <SaveRow saving={edit.saving} problem={edit.problem} onCancel={edit.cancel} />
        </form>
      ) : (
        <p className={cn("mt-2 text-[0.9rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]", !value.trim() && "text-subtle")}>{value.trim() || empty}</p>
      )}
    </div>
  );
}
