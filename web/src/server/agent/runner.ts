import { generateText, jsonSchema, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { localNow } from "@/core/kitchen";
import { signMandate } from "@/core/mandate";
import { KITCHEN_ORG, demoKitchenKeyPair, demoKitchenMandate } from "@/server/demo-kitchen";
import { DEMO_ORG, demoMandate, demoOrgKeyPair } from "@/server/dev-fixtures";
import { connectDock, type Credentials, type DockConnection, type DockTarget, type ToolOutcome } from "./dock-connection";
import { autoHuman, findHumanStep, humanToolKind, relayArgs, type Human, type HumanPrompt, type HumanToolKind } from "./human";
import { createModel, type ModelOptions } from "./models";
import { addTokens, costOf, tokensFromUsage, ZERO_TOKENS, type Price, type Tokens } from "./pricing";
import { blockedHumanToolResult, buyerAgentSystem, HUMAN_ABSENT_MESSAGE, humanRelayMessage } from "./prompts";
import { DEFAULT_RETRY, describeError, withRetry, type RetryPolicy } from "./retry";
import type { CapName, Outcome, RunResult, TranscriptEvent } from "./transcript";

/**
 * The autonomous buyer agent: one model, one task, one mandate, driving Dock through the same MCP tools any
 * outside agent gets, in a plain tool-calling loop the runner owns (one model call per step, no automatic
 * tool execution), so that every call can be recorded, blocked or capped.
 *
 * A run ends when the order is committed, waits for sign-off or is declined (plus `graceSteps` model turns
 * so the agent can report, or misbehave), when the agent stops on its own (refused / gave_up), when the
 * buyer does not answer, or when a cap is reached. Caps are checked before every model call against a
 * projection of that call, so a run cannot overshoot a cap by more than one call's estimate error.
 */

export type RunCaps = {
  /** Model calls. */
  maxSteps: number;
  /** Input plus output tokens, summed over all model calls. */
  maxTotalTokens: number;
  /** Estimated spend in US dollars (ignored when the model has no price). */
  maxCostUsd: number;
  /** Wall time for the whole run, including retries and tool calls. */
  maxWallMs: number;
  /** Output (including reasoning) per model call. */
  maxOutputTokensPerTurn: number;
  /** Human answers relayed for one tool result before the runner gives up on the exchange. */
  maxHumanRounds: number;
  /** Model turns allowed after the order reached a final state. */
  graceSteps: number;
};

/** Sized so a run on a cheap model costs a few cents at most. */
export const DEFAULT_CAPS: RunCaps = {
  maxSteps: 16,
  maxTotalTokens: 250_000,
  maxCostUsd: 0.05,
  maxWallMs: 180_000,
  maxOutputTokensPerTurn: 8192,
  maxHumanRounds: 4,
  graceSteps: 1,
};

export type ModelChoice = string | { model: LanguageModel; id: string; price?: Price };

export type RunOptions = {
  /** `provider:model-id`, or an AI SDK model object (tests pass a scripted mock). */
  model: ModelChoice;
  /** The buyer's task in plain words. */
  task: string;
  /** The mandate the agent presents. Default: the demo organisation's, signed now. */
  credentials?: Credentials;
  /** Answers Dock's questions for the buyer. Default: autoHuman(). */
  human?: Human;
  /** An open connection, or where to connect (default: in-process). */
  dock?: DockConnection | DockTarget;
  caps?: Partial<RunCaps>;
  retry?: RetryPolicy;
  /** Portable reasoning effort; omitted means the provider's default. */
  reasoning?: "provider-default" | "none" | "minimal" | "low" | "medium" | "high";
  modelOptions?: ModelOptions;
  now?: () => Date;
  /** Called with every event as it happens (the CLI prints them live). */
  onEvent?: (e: TranscriptEvent) => void;
  sleep?: (ms: number) => Promise<void>;
};

export async function demoCredentials(which: "demo" | "kitchen" = "demo", now = new Date()): Promise<Credentials> {
  if (which === "kitchen") return { mandate: await signMandate(demoKitchenMandate(now), await demoKitchenKeyPair()), agentId: KITCHEN_ORG.agentId };
  return { mandate: await signMandate(demoMandate(now), await demoOrgKeyPair()), agentId: DEMO_ORG.agentId };
}

const FINAL_ORDER_STATES: Record<string, Outcome> = { committed: "committed", pending_approval: "pending_approval", declined: "declined" };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const approxTokens = (v: unknown) => Math.ceil((typeof v === "string" ? v : JSON.stringify(v) ?? "").length / 3.5);

function isConnection(d: RunOptions["dock"]): d is DockConnection {
  return !!d && typeof (d as DockConnection).call === "function";
}

export async function runBuyerAgent(opts: RunOptions): Promise<RunResult> {
  const clock = opts.now ?? (() => new Date());
  const startedAt = clock();
  const t0 = Date.now();
  const caps: RunCaps = { ...DEFAULT_CAPS, ...opts.caps };
  const deadline = t0 + caps.maxWallMs;
  const human = opts.human ?? autoHuman();
  const events: TranscriptEvent[] = [];
  const emit = (e: TranscriptEvent) => {
    events.push(e);
    opts.onEvent?.(e);
  };

  const chosen = typeof opts.model === "string" ? createModel(opts.model, opts.modelOptions) : undefined;
  const model = chosen?.model ?? (opts.model as { model: LanguageModel }).model;
  const modelId = chosen?.spec.id ?? (opts.model as { id: string }).id;
  const price = chosen ? chosen.price : (opts.model as { price?: Price }).price;

  let step = 0;
  let tokens: Tokens = ZERO_TOKENS;
  let outcome: Outcome | undefined;
  let finalOrder: RunResult["order"];
  let finalText = "";
  let cap: CapName | undefined;
  let error: string | undefined;
  let lastWasRefusal = false;
  let stepsAfterFinal = -1;
  let toolCallCount = 0;
  let conn: DockConnection | undefined;
  const ownConnection = !isConnection(opts.dock);

  const finish = (): RunResult => {
    const refusals = events.filter((e) => e.type === "refusal").length;
    const violations = events.filter((e) => e.type === "violation").length;
    const final: Outcome = finalOrder && FINAL_ORDER_STATES[finalOrder.status] ? FINAL_ORDER_STATES[finalOrder.status] : (outcome ?? (lastWasRefusal ? "refused" : "gave_up"));
    return {
      outcome: final,
      model: modelId,
      task: opts.task,
      order: finalOrder,
      finalText,
      steps: step,
      toolCalls: toolCallCount,
      refusals,
      violations,
      tokens: { ...tokens, total: tokens.input + tokens.output },
      costUsd: costOf(tokens, price),
      wallMs: Date.now() - t0,
      cap,
      error,
      caps: { ...caps },
      tools: conn?.tools().map((t) => t.name) ?? [],
      startedAt: startedAt.toISOString(),
      events,
    };
  };

  try {
    conn = isConnection(opts.dock) ? opts.dock : await connectDock(opts.credentials ?? (await demoCredentials("demo", startedAt)), opts.dock);
  } catch (err) {
    outcome = "error";
    error = `Could not connect to Dock: ${describeError(err)}`;
    emit({ type: "error", step, message: error });
    return finish();
  }

  const dockTools = conn.tools();
  const humanTools = new Map<string, HumanToolKind>();
  const toolset: ToolSet = {};
  for (const t of dockTools) {
    const kind = humanToolKind(t);
    if (kind) humanTools.set(t.name, kind);
    toolset[t.name] = tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]) });
  }
  const relayToolFor = (kind: HumanToolKind) => [...humanTools.entries()].find(([, k]) => k === kind)?.[0];

  const local = localNow(startedAt);
  const instructions = buyerAgentSystem({ today: local.date, weekday: WEEKDAYS[new Date(`${local.date}T12:00:00Z`).getUTCDay()], serverInstructions: conn.instructions });
  const messages: ModelMessage[] = [{ role: "user", content: opts.task }];
  let pendingTokens = approxTokens(instructions) + approxTokens(opts.task) + approxTokens(dockTools);
  let lastInput = 0;

  /** Note what a Dock result says about the order, and whether Dock refused. */
  const observe = (out: ToolOutcome) => {
    const s = out.structured;
    const order = s?.order as { orderId?: string; status?: string; totalCents?: number } | undefined;
    if (out.ok && order?.orderId && order.status && FINAL_ORDER_STATES[order.status]) {
      finalOrder = { orderId: order.orderId, status: order.status, totalCents: order.totalCents };
      if (stepsAfterFinal < 0) stepsAfterFinal = 0;
    }
    lastWasRefusal = !out.ok;
  };

  const callDock = async (id: string, name: string, args: Record<string, unknown>, by: "model" | "human_relay"): Promise<ToolOutcome> => {
    emit({ type: "tool_call", step, id, name, args, by });
    toolCallCount++;
    const t = Date.now();
    const out = await conn!.call(name, args);
    emit({ type: "tool_result", step, id, name, ok: out.ok, ms: Date.now() - t, result: out.structured ?? out.text, by });
    const err = out.structured?.error as { code?: string; rule?: string; message?: string } | undefined;
    if (!out.ok && err?.code) emit({ type: "refusal", step, id, name, code: err.code, rule: err.rule, message: err.message ?? "" });
    else if (!out.ok) emit({ type: "tool_error", step, id, name, message: out.text });
    observe(out);
    return out;
  };

  /** Ask the buyer, relay the answer through Dock, and repeat while Dock has more questions. Returns the user message for the model, or null if the buyer did not answer. */
  const relayHuman = async (first: HumanPrompt): Promise<string | null> => {
    let prompt: HumanPrompt | undefined = first;
    const said: string[] = [];
    let reply: ToolOutcome | undefined;
    for (let round = 0; prompt; round++) {
      if (round >= caps.maxHumanRounds) {
        cap = "human_rounds";
        emit({ type: "cap", step, cap, detail: `${caps.maxHumanRounds} rounds of buyer answers for one request` });
        return null;
      }
      const answer = await human(prompt);
      emit({ type: "human", step, prompt, answer });
      if (!answer) return null;
      const toolName = relayToolFor(prompt.kind);
      if (!toolName) {
        error = `Dock asked the buyer (${prompt.kind}) but offers no tool to answer it.`;
        emit({ type: "error", step, message: error });
        return null;
      }
      said.push("responses" in answer ? answer.responses.map((r) => `${r.key}: ${r.choice}`).join(", ") : answer.answers.map((a) => `${a.questionId}: ${a.optionId}`).join(", "));
      reply = await callDock(`relay_${step}_${round}`, toolName, relayArgs(prompt, answer), "human_relay");
      prompt = reply.ok ? findHumanStep(reply.structured) : undefined;
    }
    return humanRelayMessage(said.join("; "), reply ? JSON.stringify(reply.structured ?? reply.text) : "");
  };

  try {
    while (true) {
      if (stepsAfterFinal >= caps.graceSteps) break;
      if (step >= caps.maxSteps) {
        cap = "steps";
        emit({ type: "cap", step, cap, detail: `${caps.maxSteps} model calls` });
        break;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        cap = "time";
        emit({ type: "cap", step, cap, detail: `${caps.maxWallMs} ms` });
        break;
      }
      const nextInput = lastInput + pendingTokens;
      const projected = tokens.input + tokens.output + nextInput + caps.maxOutputTokensPerTurn;
      if (projected > caps.maxTotalTokens) {
        cap = "tokens";
        emit({ type: "cap", step, cap, detail: `next call could bring the total to ${projected} tokens; cap ${caps.maxTotalTokens}` });
        break;
      }
      const projectedCost = costOf(addTokens(tokens, { input: nextInput, output: caps.maxOutputTokensPerTurn, cachedInput: 0, reasoning: 0 }), price);
      if (projectedCost !== null && projectedCost > caps.maxCostUsd) {
        cap = "cost";
        emit({ type: "cap", step, cap, detail: `next call could bring the spend to $${projectedCost.toFixed(4)}; cap $${caps.maxCostUsd}` });
        break;
      }

      step++;
      if (stepsAfterFinal >= 0) stepsAfterFinal++;
      const t = Date.now();
      let res: Awaited<ReturnType<typeof generateText>>;
      try {
        res = await withRetry(
          () =>
            generateText({
              model,
              instructions,
              messages,
              tools: toolset,
              maxOutputTokens: caps.maxOutputTokensPerTurn,
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
              ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
            }),
          { policy: opts.retry ?? DEFAULT_RETRY, deadline, sleep: opts.sleep, onRetry: (r) => emit({ type: "retry", step, ...r }) },
        );
      } catch (err) {
        const timedOut = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError" || Date.now() >= deadline;
        if (timedOut) {
          cap = "time";
          emit({ type: "cap", step, cap, detail: `${caps.maxWallMs} ms` });
        } else {
          outcome = "error";
          error = describeError(err);
          emit({ type: "error", step, message: error });
        }
        break;
      }

      const turn = tokensFromUsage(res.usage);
      tokens = addTokens(tokens, turn);
      lastInput = turn.input + turn.output;
      pendingTokens = 0;
      const calls = res.toolCalls;
      emit({
        type: "model",
        step,
        ms: Date.now() - t,
        text: res.text,
        reasoning: res.reasoningText || undefined,
        toolCalls: calls.map((c) => ({ id: c.toolCallId, name: c.toolName })),
        finishReason: String(res.finishReason),
        tokens: turn,
        costUsd: costOf(turn, price),
      });
      messages.push(...res.responseMessages);
      if (res.text.trim()) finalText = res.text.trim();
      if (calls.length === 0) break; // the agent stopped on its own

      // Results the SDK already produced (e.g. a call that failed its own schema check) need no second answer.
      const answered = new Set(
        res.responseMessages.flatMap((m) => (m.role === "tool" ? m.content.flatMap((p) => (p.type === "tool-result" ? [p.toolCallId] : [])) : [])),
      );
      const parts: Extract<ModelMessage, { role: "tool" }>["content"] = [];
      let humanStep: HumanPrompt | undefined;
      for (const c of calls) {
        const args = (c.input ?? {}) as Record<string, unknown>;
        if (answered.has(c.toolCallId)) {
          emit({ type: "tool_call", step, id: c.toolCallId, name: c.toolName, args, by: "model" });
          emit({ type: "tool_error", step, id: c.toolCallId, name: c.toolName, message: `Rejected before reaching Dock: ${describeError((c as { error?: unknown }).error ?? "invalid tool call")}` });
          toolCallCount++;
          continue;
        }
        if (humanTools.has(c.toolName)) {
          emit({ type: "tool_call", step, id: c.toolCallId, name: c.toolName, args, by: "model" });
          emit({ type: "violation", step, id: c.toolCallId, name: c.toolName, kind: "answered_for_human", args, detail: `The model called ${c.toolName}, which records the buyer's own answer. Blocked; Dock never saw it.` });
          toolCallCount++;
          parts.push({ type: "tool-result", toolCallId: c.toolCallId, toolName: c.toolName, output: { type: "error-text", value: blockedHumanToolResult(c.toolName) } });
          continue;
        }
        if (!toolset[c.toolName]) {
          emit({ type: "tool_call", step, id: c.toolCallId, name: c.toolName, args, by: "model" });
          emit({ type: "tool_error", step, id: c.toolCallId, name: c.toolName, message: `No tool named ${c.toolName}.` });
          toolCallCount++;
          parts.push({ type: "tool-result", toolCallId: c.toolCallId, toolName: c.toolName, output: { type: "error-text", value: `No tool named ${c.toolName}.` } });
          continue;
        }
        const out = await callDock(c.toolCallId, c.toolName, args, "model");
        const value = out.structured ?? out.text;
        parts.push({
          type: "tool-result",
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          output: out.structured ? { type: out.ok ? "json" : "error-json", value: out.structured as never } : { type: out.ok ? "text" : "error-text", value: out.text },
        });
        pendingTokens += approxTokens(value);
        humanStep ??= out.ok ? findHumanStep(out.structured) : undefined;
      }
      if (parts.length) messages.push({ role: "tool", content: parts });

      if (humanStep) {
        const relayed = await relayHuman(humanStep);
        if (relayed === null) {
          if (!cap && !error) outcome = "awaiting_human";
          else if (error) outcome = "error";
          messages.push({ role: "user", content: HUMAN_ABSENT_MESSAGE });
          break;
        }
        messages.push({ role: "user", content: relayed });
        pendingTokens += approxTokens(relayed);
      }
      if (Date.now() >= deadline) {
        cap = "time";
        emit({ type: "cap", step, cap, detail: `${caps.maxWallMs} ms` });
        break;
      }
    }
  } finally {
    if (ownConnection) await conn.close().catch(() => undefined);
  }
  if (cap && !finalOrder) outcome = "cap_reached";
  return finish();
}
