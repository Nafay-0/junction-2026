import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, pruneMessages, streamText, toUIMessageStream, type ModelMessage, type SystemModelMessage } from "ai";
import { after } from "next/server";
import { researchDepth } from "@/lib/agent/depth";
import { buildContext, buildInstructions } from "@/lib/agent/instructions";
import { RunMeter, addUsage, round, toTokenUsage } from "@/lib/agent/meter";
import { cleanEffort, getMode, pickMode } from "@/lib/agent/modes";
import { costOf, modelForMode } from "@/lib/agent/models";
import { MODE_UNAVAILABLE, agentProviderOptions, languageModel, workerModelFor } from "@/lib/agent/providers";
import { EMPTY_USAGE, type RunStats, type TokenUsage } from "@/lib/agent/stats";
import { createTools, type ButlerMessage } from "@/lib/agent/tools";
import type { ToolContext } from "@/lib/agent/tools/context";
import { requireUser } from "@/lib/auth/server";
import { clientKindOf } from "@/lib/client-kind";
import { capFor, capRefusal, spentBy } from "@/lib/db/cap";
import { conversationOrigin, saveConversation, validConversationId } from "@/lib/db/conversations";
import { readOnlyReason } from "@/lib/db/origin";
import { recordUsage } from "@/lib/db/usage";
import { RUN_ACTIVE_CODE, RUN_ACTIVE_SENTENCE } from "@/lib/run-state";
import { MAX_RUNS_PER_ACCOUNT, activeRun, follow, noteProgress, runsOf, spendingNow, startRun, type Run } from "@/lib/runs";

/** Agent runs with sub-agents and live inventory lookups can take a minute or more, and the deepest research several. */
export const maxDuration = 800;

/** Rough size, in tokens, at which older tool results are dropped from what the model re-reads. */
const TRIM_ABOVE_TOKENS = 120_000;
/**
 * Steps the model may take in one request. In the desktop app each step in the live browser is a
 * request of its own (the app takes the step and sends the result back), so this bounds the work
 * between two of them.
 */
const MAX_STEPS = 45;

type ChatRequest = {
  /** The conversation, as the interface names it. */
  id?: string;
  messages: ButlerMessage[];
  /** The mode the user picked and where the effort dial stands. The server decides which model that means. */
  mode?: string;
  effort?: number;
  /** "Espoo, Finland": where the user is, for local questions. */
  place?: string;
  /** Two-letter country code, used to localise Exa searches. */
  country?: string;
  timeZone?: string;
  /** The user's exact position, when they have shared it through the browser. */
  coords?: { lat: number; lng: number; accuracyM?: number; label?: string; country?: string };
  /** True when the user has said no to sharing their exact location. */
  locationDeclined?: boolean;
  /** Desktop app: where its live browser stands right now. */
  browser?: { status?: string; url?: string; title?: string; control?: string };
};

const estimateTokens = (messages: ModelMessage[]) => Math.ceil(JSON.stringify(messages).length / 4);

export async function POST(req: Request) {
  // Only a signed-in account talks to the agent, and what it uses is counted against that account.
  const user = await requireUser();
  if (user instanceof Response) return user;

  // An account that has used up what its admin allowed gets nothing more until the limit is raised.
  const cap = await capFor(user);
  if (cap.reached) return capRefusal();

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "No messages." }, { status: 400 });
  }

  // The account's own modes decide what it may ask for: a mode it does not have becomes the best one it has.
  const mode = pickMode(body.mode, user.modes);
  const effort = cleanEffort(body.effort);
  const info = modelForMode(mode);
  const depth = researchDepth(mode, effort);
  const meter = new RunMeter();
  let model;
  let worker;
  try {
    model = languageModel(info);
    worker = workerModelFor(info);
  } catch (err) {
    // What is missing is the server's to know, not the user's.
    console.error("[chat] the mode cannot run", mode, err);
    return Response.json({ error: MODE_UNAVAILABLE }, { status: 500 });
  }

  const timeZone = safeTimeZone(body.timeZone);
  const now = new Date();
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
  const time = `${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone })} (${timeZone})`;
  const coords = validCoords(body.coords);
  const countryCode = coords?.country ?? body.country ?? "";
  const country = /^[A-Za-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : undefined;

  // The desktop app has a live browser and the web does not: that decides which tools the agent
  // gets and what it is told it can do.
  const client = clientKindOf(req);
  const browser = client === "desktop" ? browserNote(body.browser) : undefined;

  // A conversation is continued only where it was started: one from the desktop app relies on a
  // browser the web does not have, so from the other kind of client it can be read, not continued.
  const conversationId = validConversationId(body.id) ? body.id : undefined;
  if (conversationId) {
    const origin = await conversationOrigin(user.id, conversationId);
    if (origin && origin !== client) return Response.json({ error: readOnlyReason(origin) }, { status: 409 });
    // One task at a time in a conversation: the one that is running is followed, not doubled.
    if (activeRun(user.id, conversationId)) return Response.json({ error: RUN_ACTIVE_SENTENCE, code: RUN_ACTIVE_CODE }, { status: 409 });
  }
  // Several tasks side by side are fine; an unbounded number is somebody's mistake.
  if (runsOf(user.id).length >= MAX_RUNS_PER_ACCOUNT) {
    return Response.json({ error: `You already have ${MAX_RUNS_PER_ACCOUNT} tasks running. Wait for one to finish, or stop one.` }, { status: 429 });
  }

  const ctx: ToolContext = { meter, mode, effort, depth, model: info, worker, country, today, coords: coords ? { lat: coords.lat, lng: coords.lng, label: coords.label } : undefined, client };
  const tools = createTools(ctx, model);

  // Reasoning from earlier turns is never replayed. Claude's thinking blocks are bound to the exact
  // conversation that produced them and Gemini's cannot be read by Claude, so dropping all of them
  // keeps the history valid when the user switches model or when older tool results are trimmed.
  const history = pruneMessages({
    messages: await convertToModelMessages(body.messages, { tools, ignoreIncompleteToolCalls: true }),
    reasoning: "all",
    emptyMessages: "remove",
  });

  // The fixed instructions come first and carry a cache marker, so Claude re-reads them (and the
  // tool definitions before them) at a tenth of the price on every later step and request.
  const instructions: SystemModelMessage[] = [
    { role: "system", content: buildInstructions(client), providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
    {
      role: "system",
      content: buildContext({ today, time, place: body.place?.slice(0, 80), coords, locationDeclined: body.locationDeclined === true, client, browser, depth }),
    },
  ];

  // An answer can be written in several requests: it pauses for a question, an approval or a
  // hand-over, and the next request carries on in the same message. Its figures add up across them.
  const lastMessage = body.messages.at(-1);
  const earlier = lastMessage?.role === "assistant" ? lastMessage.metadata : undefined;

  // The limit also stops a task that is running: after each step, what this request has spent so
  // far is added to what the account had already used. The step in hand finishes, its figures are
  // recorded, and the answer says why it stopped.
  // With several tasks running side by side, each one counts what all of them have spent and not
  // yet recorded, on top of what is on the account's record by now.
  let capHit = false;
  /** What the answering model has used in the steps finished so far. */
  let finishedUsage: TokenUsage = { ...EMPTY_USAGE };
  let recorded = false;
  const unrecorded = () => (recorded ? 0 : costOf(info.id, finishedUsage) + meter.exaCostUsd + meter.workerCostUsd + meter.decisionCostUsd);
  const overCap = async ({ steps: done }: { steps: Array<{ usage: Parameters<typeof toTokenUsage>[0] }> }) => {
    finishedUsage = done.reduce((sum, step) => addUsage(sum, toTokenUsage(step.usage)), { ...EMPTY_USAGE });
    if (cap.capUsd === null) return false;
    const onRecord = await spentBy(user.id).catch(() => cap.spentUsd);
    capHit = onRecord + spendingNow(user.id) >= cap.capUsd;
    return capHit;
  };

  /*
   * The run belongs to the server, not to this connection. Reloading the page, closing it or
   * opening another conversation only stops someone watching: the work goes on, the server saves
   * the result, and whoever opens the conversation again is shown the progress so far and then
   * the rest (see lib/runs.ts). Only Stop and the usage limit end a run early.
   */
  const abort = new AbortController();
  const runId = conversationId ?? crypto.randomUUID();
  // Filled in below, once the stream it takes over exists; the stream's own callbacks read it later.
  const held: { run?: Run } = {};
  const title = titleOf(body.messages);
  const save = async (messages: unknown[]) => {
    if (!conversationId) return;
    try {
      await saveConversation(user.id, conversationId, client, { title, modelLabel: getMode(mode).label, messages });
    } catch (err) {
      console.warn("[chat] could not save the conversation", err instanceof Error ? err.message : err);
    }
  };
  const record = (request: RunStats) => {
    recorded = true;
    void recordUsage({ userId: user.id, conversationId, client, model: { id: info.id, label: info.label }, kind: "chat", stats: request });
  };

  let steps = 0;
  const result = streamText({
    model,
    instructions,
    messages: history,
    tools,
    stopWhen: [isStepCount(MAX_STEPS), overCap],
    providerOptions: agentProviderOptions(info, effort),
    abortSignal: abort.signal,
    // Context overflow guard: once the conversation is large, the model stops re-reading old tool
    // results (the user still sees every widget). Reasoning goes with them, see above.
    prepareStep: ({ messages }) => {
      steps += 1;
      if (estimateTokens(messages) < TRIM_ABOVE_TOKENS) return { messages: withCacheMark(messages, info.provider) };
      meter.contextTrimmed = true;
      return { messages: pruneMessages({ messages, reasoning: "all", toolCalls: "before-last-4-messages", emptyMessages: "remove" }) };
    },
  });

  const stream = toUIMessageStream<typeof tools, ButlerMessage>({
      stream: result.stream,
      tools,
      originalMessages: body.messages,
      sendReasoning: true,
      // After each step the server notes where the conversation stands and saves it, so the record
      // does not depend on anyone watching.
      onStepEnd: ({ messages }) => {
        if (!held.run) return;
        noteProgress(held.run, withoutPictures(messages));
        void save(held.run.latest);
      },
      onEnd: async ({ messages, isAborted }) => {
        const final = withoutPictures(messages);
        if (held.run) noteProgress(held.run, final);
        // A task that was stopped, or broke off, has still used what it used.
        if (!recorded) {
          record({ mode, effort, startedAt: meter.startedAt, durationMs: Date.now() - meter.startedAt, steps, usage: finishedUsage, llmCostUsd: round(costOf(info.id, finishedUsage)), finishReason: isAborted ? "stopped" : "error", ...meter.snapshot() });
        }
        await save(final);
      },
      messageMetadata: ({ part }): RunStats | undefined => {
        // What the interface is told names the mode, never the model behind it.
        if (part.type === "start") {
          return { mode, effort, startedAt: earlier?.startedAt ?? meter.startedAt };
        }
        if (part.type === "finish") {
          const usage = toTokenUsage(part.totalUsage);
          const request: RunStats = {
            mode,
            effort,
            startedAt: meter.startedAt,
            durationMs: Date.now() - meter.startedAt,
            steps,
            usage,
            llmCostUsd: round(costOf(info.id, usage)),
            finishReason: part.finishReason,
            ...meter.snapshot(),
          };
          // This request's own figures go to the account's record; the answer shows the running total.
          record(request);
          const total = addStats(earlier, request);
          // An account that may not see usage is sent the mode and the time, and none of the figures.
          const shown: RunStats = user.showUsage ? total : { mode, effort, startedAt: total.startedAt, durationMs: total.durationMs, finishReason: total.finishReason };
          return capHit ? { ...shown, capReached: true } : shown;
        }
        return undefined;
      },
      onError: (error) => {
        console.error("[chat] stream error", error);
        return friendlyError(error);
      },
  });

  // The conversation exists on the server from the first moment, with what the user just sent.
  void save(body.messages);
  const running = startRun({ userId: user.id, conversationId: runId, client, original: body.messages, stream, abort, spent: unrecorded });
  held.run = running;
  // Where the platform would otherwise end the request with the response, it is told to wait for the run.
  after(() => running.finished);
  return createUIMessageStreamResponse({ stream: follow(running) });
}

/** A title from the first thing the user asked, as the interface would make it. */
function titleOf(messages: ButlerMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts.find((p) => p.type === "text");
  const clean = (text && text.type === "text" ? text.text : "").replace(/\s+/g, " ").trim();
  if (!clean) return first?.parts.some((p) => p.type === "file") ? "Image search" : "New task";
  return clean.length > 72 ? `${clean.slice(0, 70).trimEnd()}…` : clean;
}

/** A picture the agent took of a page is for the answer being written. It is not kept in the saved conversation. */
function withoutPictures(messages: ButlerMessage[]): ButlerMessage[] {
  const has = (p: ButlerMessage["parts"][number]) => p.type === "tool-browserLook" && p.state === "output-available" && Boolean(p.output?.picture);
  if (!messages.some((m) => m.role === "assistant" && m.parts.some(has))) return messages;
  return messages.map((m) =>
    m.role === "assistant" && m.parts.some(has) ? { ...m, parts: m.parts.map((p) => (p.type === "tool-browserLook" && p.state === "output-available" && p.output?.picture ? { ...p, output: { ...p.output, picture: undefined } } : p)) } : m,
  );
}

/** The figures of an answer that was written in more than one request: time, tokens, calls and cost add up. */
function addStats(earlier: RunStats | undefined, now: RunStats): RunStats {
  if (!earlier || earlier.durationMs === undefined) return now;
  const sum = (a: number | undefined, b: number | undefined) => (a ?? 0) + (b ?? 0);
  const usage = (a: RunStats["usage"], b: RunStats["usage"]): RunStats["usage"] =>
    a && b
      ? {
          inputTokens: a.inputTokens + b.inputTokens,
          outputTokens: a.outputTokens + b.outputTokens,
          cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
          cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
          reasoningTokens: a.reasoningTokens + b.reasoningTokens,
        }
      : (a ?? b);
  return {
    ...now,
    startedAt: earlier.startedAt,
    durationMs: sum(earlier.durationMs, now.durationMs),
    steps: sum(earlier.steps, now.steps),
    usage: usage(earlier.usage, now.usage),
    llmCostUsd: round(sum(earlier.llmCostUsd, now.llmCostUsd)),
    workerUsage: usage(earlier.workerUsage, now.workerUsage),
    workerCostUsd: round(sum(earlier.workerCostUsd, now.workerCostUsd)),
    exaCostUsd: round(sum(earlier.exaCostUsd, now.exaCostUsd)),
    decisionCostUsd: earlier.decisionCalls || now.decisionCalls ? round(sum(earlier.decisionCostUsd, now.decisionCostUsd)) : undefined,
    decisionCalls: sum(earlier.decisionCalls, now.decisionCalls) || undefined,
    exaCalls:
      earlier.exaCalls && now.exaCalls
        ? {
            search: earlier.exaCalls.search + now.exaCalls.search,
            contents: earlier.exaCalls.contents + now.exaCalls.contents,
            agent: earlier.exaCalls.agent + now.exaCalls.agent,
            answer: earlier.exaCalls.answer + now.exaCalls.answer,
          }
        : (now.exaCalls ?? earlier.exaCalls),
    contextTrimmed: earlier.contextTrimmed || now.contextTrimmed || undefined,
  };
}

/**
 * A long task re-reads the whole conversation on every step. Marking the newest message lets
 * Claude read everything before it from its cache at a twentieth of the price, which is what keeps
 * a thirty-step booking affordable and quick. The content is untouched; Gemini caches on its own.
 */
function withCacheMark(messages: ModelMessage[], provider: string): ModelMessage[] {
  if (provider !== "claude" || messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const marked = { ...last, providerOptions: { ...last.providerOptions, anthropic: { ...last.providerOptions?.anthropic, cacheControl: { type: "ephemeral" } } } } as ModelMessage;
  return [...messages.slice(0, -1), marked];
}

/** What the desktop app says about its browser, cut down to what the model is told. */
function browserNote(input: ChatRequest["browser"]): { status: string; url: string; title: string; control: string } | undefined {
  if (!input || typeof input.status !== "string") return undefined;
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  return { status: text(input.status, 20), url: text(input.url, 300), title: text(input.title, 120), control: text(input.control, 10) };
}

function validCoords(input: ChatRequest["coords"]): ChatRequest["coords"] | undefined {
  if (!input || typeof input.lat !== "number" || typeof input.lng !== "number") return undefined;
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) return undefined;
  return {
    lat: input.lat,
    lng: input.lng,
    accuracyM: typeof input.accuracyM === "number" ? Math.round(input.accuracyM) : undefined,
    label: typeof input.label === "string" ? input.label.slice(0, 80) : undefined,
    country: typeof input.country === "string" ? input.country.slice(0, 2) : undefined,
  };
}

function safeTimeZone(tz: string | undefined): string {
  if (!tz) return "Europe/Helsinki";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "Europe/Helsinki";
  }
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate limit|429/i.test(message)) return "It is busy right now. Give it a few seconds and try again.";
  if (/credit|402|billing/i.test(message)) return "The account behind this demo has run out of credit.";
  if (/context|too long|maximum/i.test(message)) return "This conversation got too long. Start a new task to continue.";
  if (/abort/i.test(message)) return "Stopped.";
  return "Something went wrong while answering. Try again, or switch mode.";
}
