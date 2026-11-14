import { AsyncLocalStorage } from "node:async_hooks";
import type { ThreadDoor } from "./types";

/**
 * Which conversation the code running now belongs to. The engine runs every agent turn inside `withTurn`, so any
 * model or tool call made underneath (the agent loop, the request reader, the memory writer) can be attributed to
 * the thread, the turn and the door without passing them through every function: the telemetry integration
 * (telemetry.ts) reads it to put model calls in the ledger and the action stream.
 */
export type TurnContext = {
  threadId: string;
  turnId: string;
  door: ThreadDoor;
  kitchen: string;
  orgId: string;
  agentId: string;
  /** Running totals for this turn, filled by the telemetry integration. */
  usage: { modelCalls: number; inputTokens: number; outputTokens: number; cachedInputTokens: number; costUsd: number; fallbacks: number; toolCalls: number };
};

const als = new AsyncLocalStorage<TurnContext>();

export function withTurn<T>(ctx: Omit<TurnContext, "usage"> & { usage?: TurnContext["usage"] }, fn: () => Promise<T>): Promise<T> {
  const full: TurnContext = { ...ctx, usage: ctx.usage ?? { modelCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, fallbacks: 0, toolCalls: 0 } };
  return als.run(full, fn);
}

export function currentTurn(): TurnContext | undefined {
  return als.getStore();
}

/** The `data.thread` every ledger entry of a conversation carries. */
export function threadTag(ctx: Pick<TurnContext, "threadId" | "turnId" | "door"> | undefined): { thread: { threadId: string; turnId: string; door: ThreadDoor } } | Record<string, never> {
  return ctx ? { thread: { threadId: ctx.threadId, turnId: ctx.turnId, door: ctx.door } } : {};
}
