import "server-only";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { describeSchedule, nextRun } from "@/lib/jobs/schedule";
import { MAX_JOBS, type JobItem, type JobRunDetail, type JobRunItem, type JobRunStatus, type JobSchedule, type JobStatus } from "@/lib/jobs/types";
import { database } from "./client";
import { jsonForPostgres } from "./conversations";
import { jobRuns, jobs, type JobRow, type JobRunRow } from "./schema";

/*
 * Jobs and their runs. Everything a user or the agent does is asked by account, and never
 * touches a row that is not theirs. The scheduler's own functions (at the bottom) work across
 * accounts and are only called by the server itself.
 */

const clipText = (text: string, max: number) => {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const summaryOf = (output: string | null) =>
  clipText(
    (output ?? "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[#*_`>|]/g, "")
      .replace(/\s+/g, " "),
    220,
  );

const limitsOf = (row: Pick<JobRow, "createdAt" | "untilAt" | "maxRuns" | "runCount">) => ({ createdAt: row.createdAt, untilAt: row.untilAt, maxRuns: row.maxRuns, runCount: row.runCount });

function toJob(row: JobRow, last?: { id: string; status: JobRunStatus; startedAt: Date }): JobItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    prompt: row.prompt,
    schedule: row.schedule as JobSchedule,
    scheduleText: row.scheduleText,
    timeZone: row.timeZone,
    untilAt: row.untilAt?.getTime(),
    maxRuns: row.maxRuns ?? undefined,
    status: row.status,
    mode: row.mode,
    effort: row.effort,
    nextRunAt: row.nextRunAt?.getTime(),
    lastRunAt: row.lastRunAt?.getTime(),
    runCount: row.runCount,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    running: last?.status === "running",
    lastRun: last ? { id: last.id, status: last.status, startedAt: last.startedAt.getTime() } : undefined,
  };
}

function toRun(row: Omit<JobRunRow, "messages">, showCost: boolean): JobRunItem {
  return {
    id: row.id,
    jobId: row.jobId,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.getTime(),
    finishedAt: row.finishedAt?.getTime(),
    error: row.error ?? undefined,
    summary: summaryOf(row.output),
    emailed: row.emailedAt !== null,
    costUsd: showCost ? row.costUsd : undefined,
  };
}

const mine = (userId: string, id: string) => and(eq(jobs.userId, userId), eq(jobs.id, id));
export const validJobId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** The latest run of each of these jobs. */
async function latestRuns(jobIds: string[]): Promise<Map<string, { id: string; status: JobRunStatus; startedAt: Date }>> {
  if (jobIds.length === 0) return new Map();
  const rows = await database()
    .selectDistinctOn([jobRuns.jobId], { id: jobRuns.id, jobId: jobRuns.jobId, status: jobRuns.status, startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(inArray(jobRuns.jobId, jobIds))
    .orderBy(jobRuns.jobId, desc(jobRuns.startedAt));
  return new Map(rows.map((r) => [r.jobId, { id: r.id, status: r.status, startedAt: r.startedAt }]));
}

/** This account's jobs, newest first. */
export async function listJobs(userId: string): Promise<JobItem[]> {
  const rows = await database().select().from(jobs).where(eq(jobs.userId, userId)).orderBy(desc(jobs.createdAt)).limit(200);
  const last = await latestRuns(rows.map((r) => r.id));
  return rows.map((row) => toJob(row, last.get(row.id)));
}

export async function getJob(userId: string, id: string): Promise<JobItem | null> {
  if (!validJobId(id)) return null;
  const [row] = await database().select().from(jobs).where(mine(userId, id)).limit(1);
  if (!row) return null;
  return toJob(row, (await latestRuns([row.id])).get(row.id));
}

export type NewJob = {
  title: string;
  description: string;
  prompt: string;
  schedule: JobSchedule;
  scheduleText?: string;
  timeZone: string;
  untilAt?: Date | null;
  maxRuns?: number | null;
  mode: string;
  effort: number;
  place?: string;
  country?: string;
  coords?: { lat: number; lng: number; label?: string };
  conversationId?: string;
};

export type Made = { ok: true; job: JobItem } | { ok: false; problem: string };

/** Make a job. Refused when the account has as many as it may, or when the schedule has no run ahead. */
export async function createJob(userId: string, input: NewJob): Promise<Made> {
  const db = database();
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.userId, userId));
  if ((count?.n ?? 0) >= MAX_JOBS) return { ok: false, problem: `This account already has ${MAX_JOBS} jobs, which is the most it can have. Delete one first.` };
  const now = new Date();
  const first = nextRun(input.schedule, input.timeZone, now, { createdAt: now, untilAt: input.untilAt, maxRuns: input.maxRuns, runCount: 0 });
  if (!first) return { ok: false, problem: "With that schedule and end, the job would never run. Check the times." };
  const [row] = await db
    .insert(jobs)
    .values({
      userId,
      title: clipText(input.title, 120) || "Job",
      description: clipText(input.description, 600),
      prompt: clipText(input.prompt, 6000),
      schedule: input.schedule,
      scheduleText: clipText(input.scheduleText || describeSchedule(input.schedule, input.timeZone), 160),
      timeZone: input.timeZone,
      untilAt: input.untilAt ?? null,
      maxRuns: input.maxRuns ?? null,
      mode: input.mode,
      effort: input.effort,
      place: input.place?.slice(0, 80) ?? null,
      country: input.country?.slice(0, 2) ?? null,
      coords: input.coords ?? null,
      conversationId: input.conversationId?.slice(0, 80) ?? null,
      nextRunAt: first,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { ok: true, job: toJob(row) };
}

export type JobChange = {
  title?: string;
  description?: string;
  prompt?: string;
  /** "active" resumes a paused job; "paused" holds it. */
  status?: "active" | "paused";
  /** A new schedule. Only the agent changes this, on the user's word; the Jobs page does not offer it. */
  schedule?: JobSchedule;
  scheduleText?: string;
  timeZone?: string;
  /** Null takes the end away. */
  untilAt?: Date | null;
  maxRuns?: number | null;
  mode?: string;
  effort?: number;
};

/** Change a job. When its timing changes, the next run is worked out again from now. */
export async function updateJob(userId: string, id: string, change: JobChange): Promise<Made | null> {
  if (!validJobId(id)) return null;
  const db = database();
  const [row] = await db.select().from(jobs).where(mine(userId, id)).limit(1);
  if (!row) return null;

  const schedule = change.schedule ?? (row.schedule as JobSchedule);
  const timeZone = change.timeZone ?? row.timeZone;
  const untilAt = change.untilAt === undefined ? row.untilAt : change.untilAt;
  const maxRuns = change.maxRuns === undefined ? row.maxRuns : change.maxRuns;
  const retimed = change.schedule !== undefined || change.timeZone !== undefined || change.untilAt !== undefined || change.maxRuns !== undefined;
  // A new schedule is a fresh start: its runs are counted from here.
  const runCount = change.schedule !== undefined ? 0 : row.runCount;
  const now = new Date();

  let status: JobStatus = row.status;
  let next = row.nextRunAt;
  if (retimed) {
    next = nextRun(schedule, timeZone, now, { createdAt: change.schedule !== undefined ? now : row.createdAt, untilAt, maxRuns, runCount });
    if (!next) return { ok: false, problem: "With that schedule and end, the job would never run again. Check the times." };
    if (status === "done") status = "active";
  }
  if (change.status === "paused" && status !== "done") status = "paused";
  if (change.status === "active" && status !== "active") {
    // Resuming picks up at the next time from now: what was missed while paused is not made up.
    next = nextRun(schedule, timeZone, now, { createdAt: row.createdAt, untilAt, maxRuns, runCount });
    if (!next) return { ok: false, problem: "This job has no run left: its time or its end has passed. Ask for a new schedule in a chat." };
    status = "active";
  }

  const [saved] = await db
    .update(jobs)
    .set({
      title: change.title !== undefined ? clipText(change.title, 120) || row.title : row.title,
      description: change.description !== undefined ? clipText(change.description, 600) : row.description,
      prompt: change.prompt !== undefined ? clipText(change.prompt, 6000) || row.prompt : row.prompt,
      schedule,
      scheduleText: change.scheduleText !== undefined ? clipText(change.scheduleText, 160) || describeSchedule(schedule, timeZone) : change.schedule !== undefined ? describeSchedule(schedule, timeZone) : row.scheduleText,
      timeZone,
      untilAt,
      maxRuns,
      runCount,
      status,
      nextRunAt: next,
      mode: change.mode ?? row.mode,
      effort: change.effort ?? row.effort,
      updatedAt: now,
    })
    .where(mine(userId, id))
    .returning();
  return { ok: true, job: toJob(saved, (await latestRuns([saved.id])).get(saved.id)) };
}

/** Delete a job and its runs. True when there was one. */
export async function deleteJob(userId: string, id: string): Promise<boolean> {
  if (!validJobId(id)) return false;
  const rows = await database().delete(jobs).where(mine(userId, id)).returning({ id: jobs.id });
  return rows.length > 0;
}

const runColumns = {
  id: jobRuns.id,
  jobId: jobRuns.jobId,
  userId: jobRuns.userId,
  trigger: jobRuns.trigger,
  status: jobRuns.status,
  startedAt: jobRuns.startedAt,
  finishedAt: jobRuns.finishedAt,
  output: jobRuns.output,
  error: jobRuns.error,
  costUsd: jobRuns.costUsd,
  emailedAt: jobRuns.emailedAt,
};

/** A job's runs, newest first, without what each one produced. */
export async function listRuns(userId: string, jobId: string, showCost: boolean, limit = 50): Promise<JobRunItem[]> {
  if (!validJobId(jobId)) return [];
  const rows = await database()
    .select(runColumns)
    .from(jobRuns)
    .where(and(eq(jobRuns.userId, userId), eq(jobRuns.jobId, jobId)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit);
  return rows.map((row) => toRun(row, showCost));
}

/** One run in full. */
export async function getRun(userId: string, runId: string, showCost: boolean): Promise<JobRunDetail | null> {
  if (!validJobId(runId)) return null;
  const [row] = await database().select().from(jobRuns).where(and(eq(jobRuns.userId, userId), eq(jobRuns.id, runId))).limit(1);
  if (!row) return null;
  return { ...toRun(row, showCost), output: row.output ?? undefined, messages: Array.isArray(row.messages) ? row.messages : [] };
}

/* ───────── For the scheduler and the runner only ───────── */

/** A job as the runner needs it: the row itself. */
export type JobToRun = JobRow;

export async function jobRow(id: string): Promise<JobRow | null> {
  const [row] = await database().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ?? null;
}

/**
 * The jobs whose time has come, each moved on to its next run as it is taken, so no job is taken
 * twice. A job with no run left after this one becomes "done".
 */
export async function takeDueJobs(now: Date, limit: number): Promise<JobRow[]> {
  if (limit <= 0) return [];
  const db = database();
  const due = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "active"), lte(jobs.nextRunAt, now)))
    .orderBy(jobs.nextRunAt)
    .limit(limit);
  const taken: JobRow[] = [];
  for (const row of due) {
    const next = nextRun(row.schedule as JobSchedule, row.timeZone, now, { ...limitsOf(row), runCount: row.runCount + 1 });
    const moved = await db
      .update(jobs)
      .set({ nextRunAt: next, runCount: row.runCount + 1, lastRunAt: now, status: next ? "active" : "done" })
      // Only if nobody else moved it meanwhile.
      .where(and(eq(jobs.id, row.id), eq(jobs.status, "active"), row.nextRunAt ? eq(jobs.nextRunAt, row.nextRunAt) : undefined))
      .returning({ id: jobs.id });
    if (moved.length > 0) taken.push(row);
  }
  return taken;
}

export async function startRunRow(job: Pick<JobRow, "id" | "userId">, trigger: "schedule" | "manual"): Promise<string> {
  const [row] = await database().insert(jobRuns).values({ jobId: job.id, userId: job.userId, trigger, status: "running" }).returning({ id: jobRuns.id });
  if (trigger === "manual") await database().update(jobs).set({ lastRunAt: new Date() }).where(eq(jobs.id, job.id));
  return row.id;
}

export async function finishRunRow(runId: string, result: { status: Exclude<JobRunStatus, "running">; output?: string; messages?: unknown[]; error?: string; costUsd?: number }): Promise<void> {
  await database()
    .update(jobRuns)
    .set({
      status: result.status,
      finishedAt: new Date(),
      output: result.output ?? null,
      messages: sql`${jsonForPostgres(result.messages ?? [])}::jsonb`,
      error: result.error?.slice(0, 400) ?? null,
      costUsd: result.costUsd ?? 0,
    })
    .where(eq(jobRuns.id, runId));
}

export async function markRunEmailed(runId: string): Promise<void> {
  await database().update(jobRuns).set({ emailedAt: new Date() }).where(eq(jobRuns.id, runId));
}

/** True when a run of this job is in progress. */
export async function isRunning(jobId: string): Promise<boolean> {
  const [row] = await database().select({ id: jobRuns.id }).from(jobRuns).where(and(eq(jobRuns.jobId, jobId), eq(jobRuns.status, "running"))).limit(1);
  return Boolean(row);
}

/** Runs that were in progress when the server last stopped can never finish: say so. */
export async function failInterruptedRuns(): Promise<number> {
  const rows = await database()
    .update(jobRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "The server restarted while this was running." })
    .where(eq(jobRuns.status, "running"))
    .returning({ id: jobRuns.id });
  return rows.length;
}
