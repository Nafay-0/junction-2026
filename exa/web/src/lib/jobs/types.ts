/*
 * Jobs, as the server and the interface both know them. No imports: used on both sides.
 *
 * A job is something the agent does by itself at set times: it looks things up the way a chat
 * on the web can (search, read pages, prices, weather, research), writes the result, and the
 * result is emailed and kept as a run. It never acts in a browser. Jobs are made in a chat.
 */

/** When a job runs. Times without an offset are wall-clock times in the job's time zone. */
export type JobSchedule =
  /** One time, at this moment ("2026-11-15T08:00"). */
  | { kind: "once"; at: string }
  /** Again and again, this far apart. The first run is at `from` when given, otherwise one interval after the job is made. */
  | { kind: "every"; every: number; unit: "minutes" | "hours" | "days" | "weeks"; from?: string }
  /** By a cron line of five fields (minute hour day-of-month month day-of-week), in the job's time zone. */
  | { kind: "cron"; cron: string };

export type JobStatus = "active" | "paused" | "done";
export type JobRunStatus = "running" | "done" | "failed" | "skipped";

export type JobItem = {
  id: string;
  title: string;
  /** What the user wants, in a sentence or two. */
  description: string;
  /** The instructions each run follows, written by the agent. */
  prompt: string;
  schedule: JobSchedule;
  /** The schedule in plain words: "Every weekday at 08:00". */
  scheduleText: string;
  timeZone: string;
  /** A repeating job stops after this moment (ms since 1970), or after this many runs. */
  untilAt?: number;
  maxRuns?: number;
  status: JobStatus;
  /** The mode each run uses (an id from lib/agent/modes.ts). */
  mode: string;
  effort: number;
  /** The next scheduled run (ms since 1970). Absent when there is none. While paused it is what would have been next. */
  nextRunAt?: number;
  lastRunAt?: number;
  /** Scheduled runs so far. */
  runCount: number;
  createdAt: number;
  updatedAt: number;
  /** A run of this job is in progress right now. */
  running: boolean;
  /** How the latest run went, if there has been one. */
  lastRun?: { id: string; status: JobRunStatus; startedAt: number };
};

export type JobRunItem = {
  id: string;
  jobId: string;
  /** "schedule": its time came. "manual": someone pressed Run now. */
  trigger: "schedule" | "manual";
  status: JobRunStatus;
  startedAt: number;
  finishedAt?: number;
  /** Why it failed or was skipped. */
  error?: string;
  /** The first lines of the result, for a list. */
  summary: string;
  /** Whether the result was emailed. */
  emailed: boolean;
  /** What the run cost in US dollars. Only sent to accounts that may see usage. */
  costUsd?: number;
};

/** One run in full: what the agent wrote (Markdown) and the run as a chat would show it. */
export type JobRunDetail = JobRunItem & { output?: string; messages: unknown[] };

/** What the routes under /api/jobs answer. */
export type JobList = { jobs: JobItem[] };
export type JobDetail = { job: JobItem; runs: JobRunItem[] };

/** A repeating job may not run more often than this. */
export const MIN_GAP_MINUTES = 5;
/** How many jobs one account may have. */
export const MAX_JOBS = 25;
