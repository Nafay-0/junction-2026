import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { createJob, deleteJob, getJob, listJobs, updateJob, type JobChange } from "@/lib/db/jobs";
import { checkSchedule, momentOf, sayWhen, upcoming, validTimeZone } from "@/lib/jobs/schedule";
import { stopJobRun } from "@/lib/jobs/run";
import type { JobItem } from "@/lib/jobs/types";
import type { JobCardData } from "@/lib/widgets/types";
import type { ToolContext } from "./context";

/*
 * The agent's hold on the user's jobs: make one from what they asked for, see what they have,
 * change one (its schedule included) and delete one. These run on the server for the account
 * that is signed in, and never touch anyone else's. A job itself only looks things up and
 * writes; what it may do is decided where it runs (lib/jobs/run.ts), not here.
 */

const scheduleInput = z
  .object({
    kind: z.enum(["once", "every", "cron"]).describe('"once": one moment. "cron": by the clock (every weekday at 8, the 1st of each month). "every": a fixed gap (every 6 hours).'),
    at: z.string().optional().describe('once: the local date and time, "2026-11-15T08:00". The user\'s own clock, no offset.'),
    every: z.number().int().min(1).optional().describe("every: how many units apart."),
    unit: z.enum(["minutes", "hours", "days", "weeks"]).optional().describe("every: the unit. A job can run at most every 5 minutes."),
    from: z.string().optional().describe('every: the local date and time of the first run, "2026-11-15T08:00". Without it the first run is one gap from now.'),
    cron: z.string().optional().describe('cron: five fields, minute hour day-of-month month day-of-week, in the user\'s local time. "0 8 * * 1-5" is weekdays at 08:00; "30 17 * * 5" is Fridays at 17:30; "0 9 1 * *" is the 1st of each month at 09:00.'),
  })
  .describe("When the job runs.");

const card = (data: Omit<JobCardData, "kind" | "sources">): JobCardData => ({ kind: "job", sources: [], ...data });

const zoneOf = (ctx: ToolContext) => (validTimeZone(ctx.timeZone) ? ctx.timeZone : "Europe/Helsinki");

/** One job as the model reads it. */
function line(job: JobItem): string {
  const next = job.status === "active" && job.nextRunAt ? `next run ${sayWhen(new Date(job.nextRunAt), job.timeZone)}` : job.status === "paused" ? "paused" : "no run left";
  const end = job.untilAt ? `, until ${sayWhen(new Date(job.untilAt), job.timeZone)}` : job.maxRuns ? `, ${job.maxRuns} runs in all` : "";
  return `- id ${job.id}: "${job.title}". ${job.scheduleText}${end} (${job.timeZone}); ${next}. For: ${job.description}`;
}

function nextRuns(job: JobItem, count = 3): number[] {
  if (job.status !== "active") return [];
  return upcoming(job.schedule, job.timeZone, count, new Date(), {
    createdAt: new Date(job.createdAt),
    untilAt: job.untilAt ? new Date(job.untilAt) : null,
    maxRuns: job.maxRuns ?? null,
    runCount: job.runCount,
  }).map((d) => d.getTime());
}

const sayRuns = (job: JobItem, runs: number[]) => (runs.length ? runs.map((at) => sayWhen(new Date(at), job.timeZone)).join("; ") : "none");

export function createJobTool(ctx: ToolContext) {
  return tool({
    description:
      "Set up a job: something you will do by yourself at set times, with the result emailed to the user and kept on their Jobs page. Use it when the user asks for anything on a schedule or at a later time " +
      '("every weekday at 8 send me the AI news", "check this price every 6 hours until Friday", "tomorrow at 9 email me the weather"). ' +
      "A job can search, read pages, look up prices, weather, flights and markets, and research; it cannot act on websites, sign in, book or buy, so do not make one for that. " +
      "A run starts from nothing but the instructions you write here, so put in everything it needs.",
    inputSchema: z.object({
      title: z.string().min(2).max(80).describe('A short name: "Morning AI news", "RTX 5090 price watch".'),
      description: z.string().min(5).max(400).describe("What the user wants out of it, in a sentence or two, in their words."),
      prompt: z
        .string()
        .min(20)
        .max(4000)
        .describe(
          "Complete instructions for each run, written for an agent that knows nothing of this chat: what to look up and where, what counts as worth reporting, thresholds and preferences the user gave (names, places, sizes, budgets), and how to lay out the result (sections, a table, how long). Say what to do when nothing changed.",
        ),
      schedule: scheduleInput,
      scheduleText: z.string().min(3).max(120).describe('The schedule in plain words, as you would say it to the user: "Every weekday at 08:00", "Every 6 hours", "Once, tomorrow at 09:00".'),
      until: z.string().optional().describe('For a repeating job the user wants to stop at some point: the local date and time after which it no longer runs, "2026-11-20T18:00". Leave out when it has no end.'),
      maxRuns: z.number().int().min(1).max(1000).optional().describe("Stop after this many runs. Leave out unless the user asked for a number of times."),
    }),
    execute: async (input): Promise<JobCardData> => {
      if (!ctx.userId) return card({ action: "refused", error: "Jobs are not available here." });
      const timeZone = zoneOf(ctx);
      const checked = checkSchedule(input.schedule, timeZone);
      if (!checked.ok) return card({ action: "refused", error: checked.problem });
      const untilAt = input.until ? momentOf(input.until, timeZone) : null;
      if (input.until && !untilAt) return card({ action: "refused", error: '`until` must be a local date and time, like "2026-11-20T18:00".' });
      if (untilAt && untilAt.getTime() <= Date.now()) return card({ action: "refused", error: "`until` is in the past." });
      const made = await createJob(ctx.userId, {
        title: input.title,
        description: input.description,
        prompt: input.prompt,
        schedule: checked.schedule,
        scheduleText: input.scheduleText,
        timeZone,
        untilAt,
        maxRuns: input.maxRuns ?? null,
        mode: ctx.mode,
        effort: ctx.effort,
        place: ctx.place,
        country: ctx.country,
        coords: ctx.coords,
        conversationId: ctx.conversationId,
      });
      if (!made.ok) return card({ action: "refused", error: made.problem });
      return card({ action: "created", job: made.job, nextRuns: nextRuns(made.job) });
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.job
        ? `The job is set up and shown to the user as a card.\n${line(output.job)}\nIts next runs: ${sayRuns(output.job, output.nextRuns ?? [])}.\n` +
          "Say in one or two sentences what it will do and when it runs first, and that the result comes by email and is kept on the Jobs page. Do not repeat the card. Do not do the job's work now unless the user asked for a first result right away."
        : `The job was NOT made. ${output.error ?? ""} Fix it and call createJob again, or tell the user what is in the way.`,
    }),
  });
}

export function listJobsTool(ctx: ToolContext) {
  return tool({
    description: "See the user's jobs: what each is for, when it runs and whether it is active. Call it before changing or deleting a job you did not make in this chat, and when the user asks what they have scheduled.",
    inputSchema: z.object({}),
    execute: async (): Promise<JobCardData> => {
      if (!ctx.userId) return card({ action: "refused", error: "Jobs are not available here." });
      return card({ action: "list", jobs: await listJobs(ctx.userId) });
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.error
        ? output.error
        : output.jobs?.length
          ? `The user has ${output.jobs.length} job${output.jobs.length === 1 ? "" : "s"}, shown to them as a list:\n${output.jobs.map(line).join("\n")}\nDo not read the list back: answer what they asked.`
          : "The user has no jobs yet.",
    }),
  });
}

export function updateJobTool(ctx: ToolContext) {
  return tool({
    description:
      "Change one of the user's jobs, when they ask: its name, what it is for, its instructions, when it runs, when it ends, or pause and resume it. Give only what changes. " +
      "A new schedule starts fresh from now. You need the job's id: from createJob in this chat, or from listJobs.",
    inputSchema: z.object({
      id: z.string().describe("The job's id."),
      title: z.string().min(2).max(80).optional(),
      description: z.string().min(5).max(400).optional(),
      prompt: z.string().min(20).max(4000).optional().describe("The whole new instructions for a run, not a patch: a run reads only this."),
      schedule: scheduleInput.optional(),
      scheduleText: z.string().min(3).max(120).optional().describe("The new schedule in plain words. Give it whenever you give `schedule`."),
      until: z.string().optional().describe('A new end: the local date and time after which it no longer runs. "none" takes the end away.'),
      maxRuns: z.number().int().min(0).max(1000).optional().describe("Stop after this many runs from now. 0 takes the limit away."),
      paused: z.boolean().optional().describe("true pauses the job; false resumes it."),
    }),
    execute: async (input): Promise<JobCardData> => {
      if (!ctx.userId) return card({ action: "refused", error: "Jobs are not available here." });
      const current = await getJob(ctx.userId, input.id);
      if (!current) return card({ action: "refused", error: "There is no job with that id. Call listJobs to see the user's jobs." });
      const change: JobChange = { title: input.title, description: input.description, prompt: input.prompt };
      if (input.schedule) {
        // A changed schedule is meant in the time zone the user is in now.
        const timeZone = zoneOf(ctx);
        const checked = checkSchedule(input.schedule, timeZone);
        if (!checked.ok) return card({ action: "refused", error: checked.problem });
        change.schedule = checked.schedule;
        change.timeZone = timeZone;
        change.scheduleText = input.scheduleText ?? "";
      }
      if (input.until !== undefined) {
        const zone = change.timeZone ?? current.timeZone;
        if (/^(none|never|no)$/i.test(input.until.trim())) change.untilAt = null;
        else {
          const untilAt = momentOf(input.until, zone);
          if (!untilAt) return card({ action: "refused", error: '`until` must be a local date and time, like "2026-11-20T18:00", or "none".' });
          if (untilAt.getTime() <= Date.now()) return card({ action: "refused", error: "`until` is in the past." });
          change.untilAt = untilAt;
        }
      }
      if (input.maxRuns !== undefined) change.maxRuns = input.maxRuns === 0 ? null : input.maxRuns;
      if (input.paused !== undefined) change.status = input.paused ? "paused" : "active";
      const saved = await updateJob(ctx.userId, input.id, change);
      if (!saved) return card({ action: "refused", error: "There is no job with that id." });
      if (!saved.ok) return card({ action: "refused", error: saved.problem });
      if (input.paused) stopJobRun(saved.job.id);
      return card({ action: "updated", job: saved.job, nextRuns: nextRuns(saved.job) });
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.job
        ? `The job was changed and is shown to the user as a card.\n${line(output.job)}\nIts next runs: ${sayRuns(output.job, output.nextRuns ?? [])}.\nConfirm the change in one sentence.`
        : `Nothing was changed. ${output.error ?? ""}`,
    }),
  });
}

export function deleteJobTool(ctx: ToolContext) {
  return tool({
    description: "Delete one of the user's jobs for good, with its past runs, when they ask. You need the job's id: from createJob in this chat, or from listJobs. If they only want it to stop for now, pause it with updateJob instead.",
    inputSchema: z.object({ id: z.string().describe("The job's id.") }),
    execute: async (input): Promise<JobCardData> => {
      if (!ctx.userId) return card({ action: "refused", error: "Jobs are not available here." });
      const job = await getJob(ctx.userId, input.id);
      if (!job) return card({ action: "refused", error: "There is no job with that id. Call listJobs to see the user's jobs." });
      stopJobRun(job.id);
      await deleteJob(ctx.userId, job.id);
      return card({ action: "deleted", job });
    },
    toModelOutput: ({ output }) => ({ type: "text", value: output.action === "deleted" ? `Deleted the job "${output.job?.title}". Confirm in one short sentence.` : `Nothing was deleted. ${output.error ?? ""}` }),
  });
}
