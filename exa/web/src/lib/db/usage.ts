import "server-only";
import { isMode } from "@/lib/agent/modes";
import type { RunStats } from "@/lib/agent/stats";
import type { ClientKind } from "@/lib/client-kind";
import { database } from "./client";
import { usageEvents } from "./schema";

export type UsageKind = "chat" | "voice" | "tool" | "job";

const whole = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
const money = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0);

/**
 * Note what one request to a model used and cost, for the admin's overview. Call it once per
 * request, when the answer finishes, with that request's own figures (not the running total of an
 * answer written in several requests). It never throws: losing a row must not break an answer.
 */
export async function recordUsage(input: {
  userId: string;
  conversationId?: string;
  client: ClientKind;
  /** The model that did the work. The figures themselves name a mode, never a model. */
  model: { id: string; label: string };
  /** "chat": a typed request. "voice": a live call or voice input. "tool": a tool run on behalf of a live call. "job": one run of a scheduled job. */
  kind: UsageKind;
  stats: RunStats;
}): Promise<void> {
  const { stats } = input;
  try {
    await database()
      .insert(usageEvents)
      .values({
        userId: input.userId,
        conversationId: input.conversationId?.slice(0, 80) ?? null,
        client: input.client === "desktop" ? "desktop" : "web",
        kind: input.kind,
        // The figures of a call say "voice" where a typed request names its mode: only a real mode is kept.
        mode: isMode(stats.mode) ? stats.mode : null,
        effort: isMode(stats.mode) && stats.effort ? stats.effort : null,
        modelId: input.model.id,
        modelLabel: input.model.label,
        inputTokens: whole(stats.usage?.inputTokens),
        outputTokens: whole(stats.usage?.outputTokens),
        cacheReadTokens: whole(stats.usage?.cacheReadTokens),
        cacheWriteTokens: whole(stats.usage?.cacheWriteTokens),
        reasoningTokens: whole(stats.usage?.reasoningTokens),
        workerInputTokens: whole(stats.workerUsage?.inputTokens),
        workerOutputTokens: whole(stats.workerUsage?.outputTokens),
        llmCostUsd: money(stats.llmCostUsd),
        workerCostUsd: money(stats.workerCostUsd),
        exaCostUsd: money(stats.exaCostUsd),
        decisionCostUsd: money(stats.decisionCostUsd),
        decisionCalls: whole(stats.decisionCalls),
        exaSearchCalls: whole(stats.exaCalls?.search),
        exaContentsCalls: whole(stats.exaCalls?.contents),
        exaAgentCalls: whole(stats.exaCalls?.agent),
        exaAnswerCalls: whole(stats.exaCalls?.answer),
        steps: whole(stats.steps),
        durationMs: whole(stats.durationMs),
      });
  } catch (err) {
    console.warn("[usage] could not record a request", err instanceof Error ? err.message : err);
  }
}
