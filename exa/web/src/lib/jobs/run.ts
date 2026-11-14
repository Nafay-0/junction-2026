import "server-only";
import { convertToModelMessages, isStepCount, pruneMessages, streamText, toUIMessageStream, type ModelMessage, type SystemModelMessage } from "ai";
import { eq } from "drizzle-orm";
import { researchDepth } from "@/lib/agent/depth";
import { buildContext, buildInstructions } from "@/lib/agent/instructions";
import { RunMeter, addUsage, round, toTokenUsage } from "@/lib/agent/meter";
import { cleanEffort, pickMode } from "@/lib/agent/modes";
import { costOf, modelForMode } from "@/lib/agent/models";
import { agentProviderOptions, languageModel, workerModelFor } from "@/lib/agent/providers";
import { EMPTY_USAGE, type RunStats, type TokenUsage } from "@/lib/agent/stats";
import { createTools, type ButlerMessage } from "@/lib/agent/tools";
import type { ToolContext } from "@/lib/agent/tools/context";
import { permissionsOf } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/types";
import { capFor, spentBy, type Cap } from "@/lib/db/cap";
import { database } from "@/lib/db/client";
import { finishRunRow, jobRow, markRunEmailed, startRunRow, takeDueJobs, type JobToRun } from "@/lib/db/jobs";
import { users } from "@/lib/db/schema";
import { recordUsage } from "@/lib/db/usage";
import { escapeHtml, EMAIL_STYLE } from "@/lib/email/layout";
import { markdownToEmailHtml, markdownToText } from "@/lib/email/markdown";
import { linkFor, notify } from "@/lib/notifications/notify";
import { spendingNow } from "@/lib/runs";
import type { Source } from "@/lib/widgets/types";
import { sayWhen } from "./schedule";

/*
 * Running a job. A run is the agent working with nobody watching: it gets the job's
 * instructions, looks things up with the tools a chat on the web has, and writes the result.
 * The result is kept with the run (as text, and as the answer a chat would show), emailed to the
 * account, and what it cost goes on the account's record like any other use. The usage limit
 * holds here too: an account at its limit has its runs skipped, and a run that reaches the
 * limit stops at its next step.
 *
 * A run never asks anything and never acts in a browser: the tools that need a person (a
 * question, sharing a location) and the ones that make jobs are left out.
 */

/** Steps the agent may take in one run. */
const MAX_STEPS = 40;
/** A run that takes longer than this is stopped. */
const RUN_LIMIT_MS = 12 * 60_000;
/** Runs in progress at once, across all accounts. The rest wait for the next look at the clock. */
const MAX_AT_ONCE = 3;
const TRIM_ABOVE_TOKENS = 120_000;

/** Tools a run does not get: they wait for a person, or they change the user's jobs. */
const NOT_IN_A_RUN = ["askUser", "requestLocation", "createJob", "updateJob", "deleteJob", "listJobs"] as const;

type Running = { runId: string; abort: AbortController; spent: () => number; userId: string };
const holder = globalThis as typeof globalThis & { __berylJobRuns?: Map<string, Running> };
const running: Map<string, Running> = (holder.__berylJobRuns ??= new Map());

/** What the account's job runs in progress have cost so far and not yet recorded. */
export const jobSpendingNow = (userId: string): number => [...running.values()].filter((r) => r.userId === userId).reduce((sum, r) => sum + r.spent(), 0);

const RULES = `# This is a scheduled job

You are running one of the user's jobs: something they asked you to do by yourself at set times. Nobody is watching and nobody can answer, so:
- Never ask a question and never offer a follow-up. Decide what a sensible person would want and say what you assumed if it matters.
- Do the work now, with your tools, for today's date. Do not answer from memory when something can be looked up.
- Write nothing until you have finished looking things up: no "let me check", no notes on your progress.
- Then write the result. It is sent to the user as an email, so it must stand on its own: start with the answer itself (no greeting, no "here is your update", no sign-off), use short headings, lists and tables where they help, give real numbers, dates and names, and link what you rely on inline as [name](address).
- Keep it as short as the job allows. When nothing has changed or nothing was found, say so in a line or two instead of padding.
- Never invent anything. If a lookup failed, say what could not be checked.
- Cards and widgets you show are kept with the run in the app, but they are not in the email: everything the user needs must also be in what you write.
- You cannot act on websites, sign in anywhere, buy, book or send anything from a job. If the job would need that, say so plainly in the result.`;

/** What the agent is handed as the request. */
function brief(job: JobToRun): string {
  return `Job: ${job.title}\n\nWhat the user wants: ${job.description}\n\nInstructions for this run:\n${job.prompt}`;
}

type Account = SessionUser & { status: "active" | "blocked" };

async function accountOf(userId: string): Promise<Account | null> {
  const [row] = await database()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status, modes: users.modes, showUsage: users.showUsage, usageCapUsd: users.usageCapUsd })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status, ...permissionsOf(row) } : null;
}

export type Started = { ok: true; runId: string } | { ok: false; status: number; problem: string };

/** "Run now": start a run of this account's job right away. It answers once the run has begun. */
export async function runNow(userId: string, jobId: string): Promise<Started> {
  const job = await jobRow(jobId).catch(() => null);
  if (!job || job.userId !== userId) return { ok: false, status: 404, problem: "That job does not exist." };
  if (running.has(job.id)) return { ok: false, status: 409, problem: "This job is already running." };
  const runId = await begin(job, "manual");
  return { ok: true, runId };
}

/** Start every job whose time has come, as far as there is room. Called by the scheduler. Returns how many it started. */
export async function runDue(now = new Date()): Promise<number> {
  const due = await takeDueJobs(now, MAX_AT_ONCE - running.size);
  let started = 0;
  for (const job of due) {
    // "Run now" was pressed a moment ago and is still going: this turn is covered by it.
    if (running.has(job.id)) continue;
    await begin(job, "schedule");
    started += 1;
  }
  return started;
}

/** Stop a job's run in progress (the job was deleted or paused). */
export function stopJobRun(jobId: string): boolean {
  const entry = running.get(jobId);
  entry?.abort.abort();
  return Boolean(entry);
}

async function begin(job: JobToRun, trigger: "schedule" | "manual"): Promise<string> {
  const runId = await startRunRow(job, trigger);
  const abort = new AbortController();
  const entry: Running = { runId, abort, spent: () => 0, userId: job.userId };
  running.set(job.id, entry);
  const limit = setTimeout(() => abort.abort(), RUN_LIMIT_MS);
  void carryOut(job, runId, trigger, entry)
    .catch((err) => console.error("[jobs] a run broke off", job.id, err))
    .finally(() => {
      clearTimeout(limit);
      if (running.get(job.id) === entry) running.delete(job.id);
    });
  return runId;
}

async function carryOut(job: JobToRun, runId: string, trigger: "schedule" | "manual", entry: Running): Promise<void> {
  const link = { jobId: job.id, runId };
  const fail = async (status: "failed" | "skipped", reason: string, tell: boolean, extra: { output?: string; messages?: unknown[]; costUsd?: number } = {}) => {
    await finishRunRow(runId, { status, error: reason, ...extra });
    if (!tell) return;
    // The same trouble on every run of a busy job is told once a day, not every time.
    const day = new Date().toISOString().slice(0, 10);
    await notify({ userId: job.userId, kind: "job_failed", title: `${job.title} did not run`, body: reason, ...link, dedupe: `job-trouble:${job.id}:${day}`, email: "always" });
  };

  const account = await accountOf(job.userId);
  if (!account || account.status !== "active") return fail("skipped", "The account is not active.", false);
  const cap = await capFor(account);
  if (cap.reached) return fail("skipped", "The account has reached its usage limit. Jobs run again once the limit is raised.", true);

  let done: Worked;
  try {
    done = await work(job, account, cap, entry);
  } catch (err) {
    console.error("[jobs] a run failed", job.id, err);
    return fail("failed", friendly(err), true);
  }
  const { output, messages, costUsd } = done;
  if (!output.trim()) return fail("failed", done.problem ?? "The run ended without a result.", true, { messages, costUsd });
  if (done.problem) {
    // It wrote something before it was cut short: keep it, and say why it is not whole.
    await finishRunRow(runId, { status: "failed", output, messages, costUsd, error: done.problem });
  } else {
    await finishRunRow(runId, { status: "done", output, messages, costUsd });
  }

  const when = sayWhen(new Date(), job.timeZone);
  const sources = sourcesHtml(done.sources);
  const told = await notify({
    userId: job.userId,
    kind: "job_done",
    title: job.title,
    body: markdownToText(output).replace(/\s+/g, " ").slice(0, 220),
    ...link,
    dedupe: `run:${runId}`,
    // The email is what a job is for: it goes out whether or not the user has Beryl open.
    email: "always",
    page: {
      label: trigger === "manual" ? "Job result · Run now" : "Job result",
      heading: job.title,
      lead: `${when} · ${job.scheduleText}`,
      bodyHtml: `${markdownToEmailHtml(output)}${done.problem ? `<p style="margin:16px 0 0;color:${EMAIL_STYLE.MUTED}">${escapeHtml(done.problem)}</p>` : ""}${sources}`,
      button: { label: "Open this run", href: linkFor(link) },
      why: "You set this job up in Beryl. You can pause, change or delete it on the Jobs page.",
      subject: `${job.title} · ${when}`,
      preview: markdownToText(output).replace(/\s+/g, " ").slice(0, 140),
      text: `${job.title}\n${when} · ${job.scheduleText}\n\n${markdownToText(output)}\n\n${linkFor(link)}`,
    },
  });
  if (told.emailed) await markRunEmailed(runId);
}

type Worked = { output: string; messages: unknown[]; costUsd: number; sources: Source[]; problem?: string };

async function work(job: JobToRun, account: Account, cap: Cap, entry: Running): Promise<Worked> {
  const mode = pickMode(job.mode, account.modes);
  const effort = cleanEffort(job.effort);
  const info = modelForMode(mode);
  const depth = researchDepth(mode, effort);
  const meter = new RunMeter();
  const model = languageModel(info);
  const worker = workerModelFor(info);

  const timeZone = job.timeZone;
  const now = new Date();
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
  const time = `${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone })} (${timeZone})`;
  const stored = job.coords as { lat?: number; lng?: number; label?: string } | null;
  const coords = stored && typeof stored.lat === "number" && typeof stored.lng === "number" ? { lat: stored.lat, lng: stored.lng, label: stored.label } : undefined;

  const ctx: ToolContext = { meter, mode, effort, depth, model: info, worker, country: job.country ?? undefined, today, coords, client: "web" };
  const tools = createTools(ctx, model);
  for (const name of NOT_IN_A_RUN) delete (tools as Record<string, unknown>)[name];

  const question = { id: `job-${entry.runId}`, role: "user", parts: [{ type: "text", text: brief(job) }] } as ButlerMessage;
  const instructions: SystemModelMessage[] = [
    { role: "system", content: buildInstructions("web"), providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
    // "Declined" keeps the agent from asking for a location nobody is there to share.
    { role: "system", content: `${buildContext({ today, time, place: job.place ?? undefined, coords, locationDeclined: true, client: "web", depth })}\n\n${RULES}` },
  ];

  let capHit = false;
  let finishedUsage: TokenUsage = { ...EMPTY_USAGE };
  let recorded = false;
  const unrecorded = () => (recorded ? 0 : costOf(info.id, finishedUsage) + meter.exaCostUsd + meter.workerCostUsd + meter.decisionCostUsd);
  entry.spent = unrecorded;
  const overCap = async ({ steps: finished }: { steps: Array<{ usage: Parameters<typeof toTokenUsage>[0] }> }) => {
    finishedUsage = finished.reduce((sum, step) => addUsage(sum, toTokenUsage(step.usage)), { ...EMPTY_USAGE });
    if (cap.capUsd === null) return false;
    const onRecord = await spentBy(account.id).catch(() => cap.spentUsd);
    capHit = onRecord + spendingNow(account.id) + jobSpendingNow(account.id) >= cap.capUsd;
    return capHit;
  };

  let steps = 0;
  const result = streamText({
    model,
    instructions,
    messages: pruneMessages({ messages: await convertToModelMessages([question], { tools, ignoreIncompleteToolCalls: true }), reasoning: "all", emptyMessages: "remove" }),
    tools,
    stopWhen: [isStepCount(MAX_STEPS), overCap],
    providerOptions: agentProviderOptions(info, effort),
    abortSignal: entry.abort.signal,
    prepareStep: ({ messages }) => {
      steps += 1;
      if (estimateTokens(messages) < TRIM_ABOVE_TOKENS) return { messages };
      meter.contextTrimmed = true;
      return { messages: pruneMessages({ messages, reasoning: "all", toolCalls: "before-last-4-messages", emptyMessages: "remove" }) };
    },
  });

  let final: ButlerMessage[] = [question];
  let problem: string | undefined;
  let usage: TokenUsage | undefined;
  let finishReason: string | undefined;
  const stream = toUIMessageStream<typeof tools, ButlerMessage>({
    stream: result.stream,
    tools,
    originalMessages: [question],
    // What it thought on the way is not part of a result.
    sendReasoning: false,
    onEnd: ({ messages, isAborted }) => {
      final = messages;
      if (isAborted) problem = "It was stopped before it finished.";
    },
    messageMetadata: ({ part }): RunStats | undefined => {
      if (part.type === "start") return { mode, effort, startedAt: meter.startedAt };
      if (part.type === "finish") {
        usage = toTokenUsage(part.totalUsage);
        finishReason = part.finishReason;
        // The answer kept with the run names the mode and the time, and none of the figures: the run's cost is its own column.
        return { mode, effort, startedAt: meter.startedAt, durationMs: Date.now() - meter.startedAt, finishReason: part.finishReason };
      }
      return undefined;
    },
    onError: (error) => {
      console.error("[jobs] stream error", job.id, error);
      problem = friendly(error);
      return problem;
    },
  });
  const reader = stream.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }

  const spent = usage ?? finishedUsage;
  const stats: RunStats = {
    mode,
    effort,
    startedAt: meter.startedAt,
    durationMs: Date.now() - meter.startedAt,
    steps,
    usage: spent,
    llmCostUsd: round(costOf(info.id, spent)),
    finishReason: finishReason ?? (problem ? "error" : "stop"),
    ...meter.snapshot(),
  };
  recorded = true;
  await recordUsage({ userId: account.id, conversationId: job.id, client: "web", model: { id: info.id, label: info.label }, kind: "job", stats });
  const costUsd = round((stats.llmCostUsd ?? 0) + (stats.workerCostUsd ?? 0) + (stats.exaCostUsd ?? 0) + (stats.decisionCostUsd ?? 0));
  if (capHit) problem = "It stopped part-way: the account reached its usage limit.";

  const answer = final.filter((m) => m.role === "assistant");
  return { output: writtenBy(answer), messages: answer, costUsd, sources: sourcesOf(answer), problem };
}

const estimateTokens = (messages: ModelMessage[]) => Math.ceil(JSON.stringify(messages).length / 4);

type AnyPart = { type: string; text?: string; state?: string; output?: { report?: string; question?: string; sources?: Source[] } };

/**
 * What the agent wrote as its result: the text after its last lookup (what came before is at
 * most a note to itself), with any research report it produced on the way.
 */
function writtenBy(messages: ButlerMessage[]): string {
  const parts = messages.flatMap((m) => m.parts as AnyPart[]);
  const lastTool = parts.findLastIndex((p) => p.type.startsWith("tool-"));
  const text = (from: number) =>
    parts
      .slice(from)
      .filter((p) => p.type === "text" && p.text?.trim())
      .map((p) => p.text!.trim());
  const after = text(lastTool + 1);
  const written = after.length > 0 ? after : text(0);
  const reports = parts
    .filter((p) => p.type === "tool-deepResearch" && p.state === "output-available" && p.output?.report?.trim())
    .map((p) => `${p.output!.question ? `# ${p.output!.question}\n\n` : ""}${p.output!.report!.trim()}`);
  return [...written, ...reports].join("\n\n");
}

/** The pages the run relied on, each once. */
function sourcesOf(messages: ButlerMessage[]): Source[] {
  const seen = new Map<string, Source>();
  for (const part of messages.flatMap((m) => m.parts as AnyPart[])) {
    if (part.state !== "output-available" || !Array.isArray(part.output?.sources)) continue;
    for (const source of part.output.sources) if (source?.url && /^https?:/i.test(source.url) && !seen.has(source.url)) seen.set(source.url, source);
  }
  return [...seen.values()];
}

function sourcesHtml(sources: Source[]): string {
  if (sources.length === 0) return "";
  const { MUTED, LINE, BRAND, FONT } = EMAIL_STYLE;
  const rows = sources
    .slice(0, 12)
    .map((s) => `<li style="margin:0 0 5px"><a href="${escapeHtml(s.url)}" style="color:${BRAND};text-decoration:underline">${escapeHtml((s.title ?? s.domain).slice(0, 110))}</a> <span style="color:${MUTED}">· ${escapeHtml(s.domain)}</span></li>`)
    .join("");
  const more = sources.length > 12 ? `<p style="margin:6px 0 0;font:400 13px ${FONT};color:${MUTED}">and ${sources.length - 12} more, with the run in the app.</p>` : "";
  return `<div style="margin-top:22px;padding-top:16px;border-top:1px solid ${LINE}"><p style="margin:0 0 8px;font:600 12px ${FONT};letter-spacing:0.06em;text-transform:uppercase;color:${MUTED}">Sources</p><ol style="margin:0;padding-left:20px;font:400 13px/1.5 ${FONT}">${rows}</ol>${more}</div>`;
}

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(message)) return "It was stopped before it finished.";
  if (/rate limit|429/i.test(message)) return "The service was too busy. It will try again at the next run.";
  if (/credit|402|billing/i.test(message)) return "The account behind this server has run out of credit.";
  if (/not set up|not configured|api key/i.test(message)) return "The mode this job runs in is not set up on the server.";
  return "Something went wrong during the run.";
}
