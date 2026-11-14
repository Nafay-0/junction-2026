import { registerTelemetry, type Telemetry } from "ai";
import { recordLlmSpend } from "@/server/limits";
import { costOf, priceOf, tokensFromUsage } from "@/server/agent/pricing";
import { currentTurn, threadTag } from "./context";

/**
 * The AI SDK's telemetry, wired into Dock's own record. One integration, registered once for the whole process, so
 * every model and tool call the SDK makes (the agent loop, the request reader, the memory proposer, the assistant)
 * is measured the same way: latency, tokens, cached tokens, cost, the model, and, inside a conversation, the
 * thread, the turn and the door (read from the turn context, context.ts).
 *
 * Where it goes:
 *   - inside a conversation, a ledger entry of type `agent` (data.event "model_call" / "tool_call"), so the
 *     operations trace shows each conversation's model and tool calls in order, hash-chained with everything else;
 *   - the action stream (Aiven Kafka or PostgreSQL when configured) as `agent.model` / `agent.tool` events;
 *   - a small in-memory ring for the operations portal's live numbers.
 * A failure here never fails a call (the SDK catches integration errors, and every write below is best effort).
 */

export type TelemetryRow = {
  at: string;
  kind: "model" | "tool";
  functionId?: string;
  model?: string;
  tool?: string;
  ms: number;
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number | null;
  door?: string;
  threadId?: string;
  turnId?: string;
};

const RING = 500;
const g = globalThis as typeof globalThis & { __dockTelemetry?: { rows: TelemetryRow[]; registered: boolean } };
const state = () => (g.__dockTelemetry ??= { rows: [], registered: false });

export function recentTelemetry(): readonly TelemetryRow[] {
  return state().rows;
}

/** `anthropic.messages` + `claude-fable-5-2` → `anthropic:claude-fable-5-2`, the id prices are kept under. */
export function modelKey(provider: string, modelId: string): string {
  return `${provider.split(".")[0]}:${modelId}`;
}

/** The conversation's own model calls (the agent loop) are counted against the daily caps here; other surfaces count their own. */
const COUNTS_OWN_SPEND = (functionId: string | undefined) => !!functionId?.startsWith("thread.");

async function sink(row: TelemetryRow): Promise<void> {
  const s = state();
  s.rows.push(row);
  if (s.rows.length > RING) s.rows.splice(0, s.rows.length - RING);
  const turn = currentTurn();
  try {
    const { getRuntime } = await import("@/server/runtime");
    const rt = await getRuntime();
    if (turn) {
      const what = row.kind === "model" ? `model ${row.model}` : `tool ${row.tool}`;
      rt.dock.ledger.append({
        type: "agent",
        actor: `agent:${turn.agentId}`,
        summary:
          row.kind === "model"
            ? `The agent's ${row.functionId ?? "model"} call to ${row.model} took ${row.ms} ms (${row.inputTokens ?? 0} tokens in, ${row.cachedInputTokens ?? 0} of them cached, ${row.outputTokens ?? 0} out${row.costUsd != null ? `, $${row.costUsd.toFixed(4)}` : ""}).`
            : `The agent called ${row.tool} (${row.ms} ms, ${row.ok ? "ok" : "failed"}).`,
        data: { event: row.kind === "model" ? "model_call" : "tool_call", ...threadTag(turn), ...row, what },
      });
    }
    const { actionEvent } = await import("@/server/aiven/actions");
    rt.aiven.actions.emit(
      actionEvent({
        kind: row.kind === "model" ? "agent.model" : "agent.tool",
        agentId: turn?.agentId,
        orgId: turn?.orgId,
        value: row.ms,
        ok: row.ok,
        summary: row.kind === "model" ? `${row.model} ${row.ms} ms` : `${row.tool} ${row.ms} ms`,
        attrs: { functionId: row.functionId, model: row.model, tool: row.tool, inputTokens: row.inputTokens, outputTokens: row.outputTokens, cachedInputTokens: row.cachedInputTokens, costUsd: row.costUsd ?? undefined, door: turn?.door, threadId: turn?.threadId, turnId: turn?.turnId },
      }),
    );
  } catch {
    // telemetry is best effort
  }
}

class DockTelemetry implements Telemetry {
  onLanguageModelCallEnd: Telemetry["onLanguageModelCallEnd"] = (e) => {
    const model = modelKey(e.provider, e.modelId);
    const tokens = tokensFromUsage(e.usage);
    const costUsd = costOf(tokens, priceOf(model));
    const turn = currentTurn();
    if (turn) {
      turn.usage.modelCalls++;
      turn.usage.inputTokens += tokens.input;
      turn.usage.outputTokens += tokens.output;
      turn.usage.cachedInputTokens += tokens.cachedInput;
      turn.usage.costUsd += costUsd ?? 0;
    }
    if (COUNTS_OWN_SPEND(e.functionId)) recordLlmSpend(costUsd);
    return sink({
      at: new Date().toISOString(),
      kind: "model",
      functionId: e.functionId,
      model,
      ms: Math.round(e.performance.responseTimeMs),
      ok: e.finishReason !== "error",
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cachedInputTokens: tokens.cachedInput,
      costUsd,
      door: turn?.door,
      threadId: turn?.threadId,
      turnId: turn?.turnId,
    });
  };

  onToolExecutionEnd: Telemetry["onToolExecutionEnd"] = (e) => {
    const turn = currentTurn();
    if (turn) turn.usage.toolCalls++;
    return sink({
      at: new Date().toISOString(),
      kind: "tool",
      functionId: e.functionId,
      tool: e.toolCall.toolName,
      ms: Math.round(e.toolExecutionMs),
      ok: e.toolOutput.type === "tool-result",
      door: turn?.door,
      threadId: turn?.threadId,
      turnId: turn?.turnId,
    });
  };
}

/** Register the integration once per process (idempotent). Called by the engine and by instrumentation.ts. */
export function ensureTelemetry(): void {
  const s = state();
  if (s.registered) return;
  s.registered = true;
  registerTelemetry(new DockTelemetry());
}
