import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, pruneMessages, streamText, toUIMessageStream, type ModelMessage, type SystemModelMessage } from "ai";
import { buildContext, buildInstructions } from "@/lib/agent/instructions";
import { RunMeter, round, toTokenUsage } from "@/lib/agent/meter";
import { costOf, getModel, type RunStats } from "@/lib/agent/models";
import { agentProviderOptions, languageModel, workerModelFor } from "@/lib/agent/providers";
import { createTools, type ButlerMessage } from "@/lib/agent/tools";
import type { ToolContext } from "@/lib/agent/tools/context";
import { browserFor, validBrowserId, type ActInput } from "@/lib/browser/session";

/** Agent runs with sub-agents and live inventory lookups can take a minute or more. */
export const maxDuration = 300;

/** Rough size, in tokens, at which older tool results are dropped from what the model re-reads. */
const TRIM_ABOVE_TOKENS = 120_000;
/** A task in the live browser takes one model step per click, so the limit has to leave room for a whole booking form. */
const MAX_STEPS = 45;

/**
 * Signs the approval requests this server issues, so an approval cannot be forged by editing the
 * conversation the browser sends back. Set HOVI_APPROVAL_SECRET to keep approvals valid across
 * restarts and across several server instances; without it a random one lasts as long as the process.
 */
const secrets = globalThis as unknown as { __hoviApprovalSecret?: string };
const approvalSecret = process.env.HOVI_APPROVAL_SECRET || (secrets.__hoviApprovalSecret ??= crypto.randomUUID() + crypto.randomUUID());

type ChatRequest = {
  messages: ButlerMessage[];
  modelId?: string;
  /** "Espoo, Finland": where the user is, for local questions. */
  place?: string;
  /** Two-letter country code, used to localise Exa searches. */
  country?: string;
  timeZone?: string;
  /** The user's exact position, when they have shared it through the browser. */
  coords?: { lat: number; lng: number; accuracyM?: number; label?: string; country?: string };
  /** True when the user has said no to sharing their exact location. */
  locationDeclined?: boolean;
  /** This visitor's live browser. */
  browserId?: string;
  /** Which browser they chose: the app's own, or a window of their own Chrome. */
  browserKind?: string;
};

const estimateTokens = (messages: ModelMessage[]) => Math.ceil(JSON.stringify(messages).length / 4);

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "No messages." }, { status: 400 });
  }

  const info = getModel(body.modelId);
  const meter = new RunMeter();
  let model;
  let worker;
  try {
    model = languageModel(info);
    worker = workerModelFor(info);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "The model is not configured." }, { status: 500 });
  }

  const timeZone = safeTimeZone(body.timeZone);
  const now = new Date();
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
  const time = `${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone })} (${timeZone})`;
  const coords = validCoords(body.coords);
  const countryCode = coords?.country ?? body.country ?? "";
  const country = /^[A-Za-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : undefined;

  const browserId = validBrowserId(body.browserId) ? body.browserId : undefined;
  const browser = browserId ? browserFor(browserId) : undefined;
  browser?.setTimeZone(timeZone);
  browser?.preferKind(body.browserKind === "own" ? "own" : "assisted");
  browser?.beginTurn();

  const ctx: ToolContext = { meter, model: info, worker, country, today, coords: coords ? { lat: coords.lat, lng: coords.lng, label: coords.label } : undefined, browserId };
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
    { role: "system", content: buildInstructions(), providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
    {
      role: "system",
      content: buildContext({ today, time, place: body.place?.slice(0, 80), coords, locationDeclined: body.locationDeclined === true, browser: browser?.snapshotState() }),
    },
  ];

  // An answer can be written in several requests: it pauses for a question, an approval or a
  // hand-over, and the next request carries on in the same message. Its figures add up across them.
  const lastMessage = body.messages.at(-1);
  const earlier = lastMessage?.role === "assistant" ? lastMessage.metadata : undefined;

  let steps = 0;
  const result = streamText({
    model,
    instructions,
    messages: history,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    providerOptions: agentProviderOptions(info),
    abortSignal: req.signal,
    // Steps in the live browser that act on the user's behalf wait for the user's yes. The decision
    // is made in code from what the element is (lib/browser/guard.ts), not left to the model.
    toolApproval: {
      browserAct: async (input, { toolCallId }) => {
        if (!browser) return undefined;
        const verdict = await browser.review(toolCallId, input as ActInput);
        return verdict.decision === "approve" ? { type: "user-approval", reason: input.summary?.trim() || verdict.reason } : undefined;
      },
    },
    experimental_toolApprovalSecret: approvalSecret,
    // Context overflow guard: once the conversation is large, the model stops re-reading old tool
    // results (the user still sees every widget). Reasoning goes with them, see above.
    prepareStep: ({ messages }) => {
      steps += 1;
      if (estimateTokens(messages) < TRIM_ABOVE_TOKENS) return { messages: withCacheMark(messages, info.provider) };
      meter.contextTrimmed = true;
      return { messages: pruneMessages({ messages, reasoning: "all", toolCalls: "before-last-4-messages", emptyMessages: "remove" }) };
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof tools, ButlerMessage>({
      stream: result.stream,
      tools,
      originalMessages: body.messages,
      sendReasoning: true,
      messageMetadata: ({ part }): RunStats | undefined => {
        if (part.type === "start") {
          return { modelId: info.id, modelLabel: info.label, startedAt: earlier?.startedAt ?? meter.startedAt };
        }
        if (part.type === "finish") {
          const usage = toTokenUsage(part.totalUsage);
          return addStats(earlier, {
            modelId: info.id,
            modelLabel: info.label,
            startedAt: meter.startedAt,
            durationMs: Date.now() - meter.startedAt,
            steps,
            usage,
            llmCostUsd: round(costOf(info.id, usage)),
            finishReason: part.finishReason,
            ...meter.snapshot(),
          });
        }
        return undefined;
      },
      onError: (error) => {
        console.error("[chat] stream error", error);
        return friendlyError(error);
      },
    }),
  });
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
  if (/rate limit|429/i.test(message)) return "The model is busy right now. Give it a few seconds and try again.";
  if (/credit|402|billing/i.test(message)) return "The account behind this demo has run out of credit.";
  if (/context|too long|maximum/i.test(message)) return "This conversation got too long for the model. Start a new chat to continue.";
  if (/abort/i.test(message)) return "Stopped.";
  return "Something went wrong while answering. Try again, or switch model.";
}
