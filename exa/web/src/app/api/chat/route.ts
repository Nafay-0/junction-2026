import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, pruneMessages, streamText, toUIMessageStream, type ModelMessage, type SystemModelMessage } from "ai";
import { buildContext, buildInstructions } from "@/lib/agent/instructions";
import { RunMeter, round, toTokenUsage } from "@/lib/agent/meter";
import { costOf, getModel, type RunStats } from "@/lib/agent/models";
import { agentProviderOptions, languageModel, workerModelFor } from "@/lib/agent/providers";
import { createTools, type ButlerMessage } from "@/lib/agent/tools";
import type { ToolContext } from "@/lib/agent/tools/context";

/** Agent runs with sub-agents and live inventory lookups can take a minute or more. */
export const maxDuration = 300;

/** Rough size, in tokens, at which older tool results are dropped from what the model re-reads. */
const TRIM_ABOVE_TOKENS = 120_000;
const MAX_STEPS = 14;

type ChatRequest = {
  messages: ButlerMessage[];
  modelId?: string;
  /** "Espoo, Finland": where the user is, for local questions. */
  place?: string;
  /** Two-letter country code, used to localise Exa searches. */
  country?: string;
  timeZone?: string;
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
  const country = /^[A-Za-z]{2}$/.test(body.country ?? "") ? body.country!.toUpperCase() : undefined;

  const ctx: ToolContext = { meter, model: info, worker, country, today };
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
    { role: "system", content: buildContext({ today, time, place: body.place?.slice(0, 80) }) },
  ];

  let steps = 0;
  const result = streamText({
    model,
    instructions,
    messages: history,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    providerOptions: agentProviderOptions(info),
    abortSignal: req.signal,
    // Context overflow guard: once the conversation is large, the model stops re-reading old tool
    // results (the user still sees every widget). Reasoning goes with them, see above.
    prepareStep: ({ messages }) => {
      steps += 1;
      if (estimateTokens(messages) < TRIM_ABOVE_TOKENS) return {};
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
          return { modelId: info.id, modelLabel: info.label, startedAt: meter.startedAt };
        }
        if (part.type === "finish") {
          const usage = toTokenUsage(part.totalUsage);
          return {
            modelId: info.id,
            modelLabel: info.label,
            startedAt: meter.startedAt,
            durationMs: Date.now() - meter.startedAt,
            steps,
            usage,
            llmCostUsd: round(costOf(info.id, usage)),
            finishReason: part.finishReason,
            ...meter.snapshot(),
          };
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
