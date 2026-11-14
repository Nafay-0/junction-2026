import "server-only";
import type { UIMessageChunk } from "ai";
import type { ClientKind } from "@/lib/client-kind";

/*
 * Tasks that keep going. A request to the agent starts a run, and the run belongs to the server,
 * not to the connection that started it: reloading the page, closing it or opening another
 * conversation only stops someone watching. The run carries on, its result is saved by the
 * server, and whoever opens the conversation again is shown what has happened so far and then
 * what happens next. A run stops early only when the user presses Stop, or when the account
 * reaches its usage limit.
 *
 * How: everything a run streams is kept here until it ends. A watcher is given all of it from
 * the start and then follows along, which is exactly what the interface needs to rebuild the
 * answer (the AI SDK's resumed streams are replays). Several people, and several tasks of one
 * person, run side by side: each run is its own entry, with its own meter and its own stream.
 *
 * This lives in the memory of one server process. That is right for a server that stays up (a
 * container, a VM, `next start`); it is not enough where each request may land on a different
 * short-lived instance. There the same shape would sit on Redis (see the AI SDK's guide to
 * resumable streams).
 */

/** How many tasks one account may have running at once. */
export const MAX_RUNS_PER_ACCOUNT = 6;
/** For this long after a run ends, the server's own copy of the conversation is the one that counts. */
const SETTLE_MS = 6_000;

export type Run = {
  userId: string;
  conversationId: string;
  client: ClientKind;
  startedAt: number;
  /** The conversation as the request brought it: what a watcher starts from before the replay. */
  original: unknown[];
  /** The conversation as it stands after the last finished step. Saved from here. */
  latest: unknown[];
  /** Everything streamed so far. A superseded progress report of a tool is emptied, not removed, so positions hold. */
  chunks: Array<UIMessageChunk | undefined>;
  done: boolean;
  /** Stops the work. Only Stop and the usage limit use it; a closed connection never does. */
  abort: AbortController;
  /** What this run has cost so far and has not yet been recorded: for the usage limit across tasks running side by side. */
  spent: () => number;
  /** Resolves when the run is over and its result has been saved. */
  finished: Promise<void>;
  /** Watchers to wake when there is something new. */
  listeners: Set<() => void>;
  /** Where each tool's latest progress report sits in `chunks`. */
  progressAt: Map<string, number>;
};

type Ended = { at: number; messages: unknown[] };
type Registry = { runs: Map<string, Run>; ended: Map<string, Ended> };

// One registry per process, kept across code reloads in development.
const holder = globalThis as typeof globalThis & { __berylRuns?: Registry };
const registry: Registry = (holder.__berylRuns ??= { runs: new Map(), ended: new Map() });

const keyOf = (userId: string, conversationId: string) => `${userId}\n${conversationId}`;

/** The run in progress for this account's conversation, if there is one. */
export function activeRun(userId: string, conversationId: string): Run | undefined {
  const run = registry.runs.get(keyOf(userId, conversationId));
  return run && !run.done ? run : undefined;
}

/** Every run this account has in progress. */
export function runsOf(userId: string): Run[] {
  return [...registry.runs.values()].filter((run) => run.userId === userId && !run.done);
}

/** What the account's running tasks have cost so far and not yet recorded. */
export function spendingNow(userId: string): number {
  return runsOf(userId).reduce((sum, run) => sum + run.spent(), 0);
}

/**
 * Start a run: take over the stream and keep reading it to the end whether or not anyone is
 * watching. `save` is called with the conversation as it stands when the run is over.
 */
export function startRun(input: {
  userId: string;
  conversationId: string;
  client: ClientKind;
  original: unknown[];
  stream: ReadableStream<UIMessageChunk>;
  abort: AbortController;
  spent: () => number;
}): Run {
  const key = keyOf(input.userId, input.conversationId);
  let settle: () => void = () => {};
  const run: Run = {
    userId: input.userId,
    conversationId: input.conversationId,
    client: input.client,
    startedAt: Date.now(),
    original: input.original,
    latest: input.original,
    chunks: [],
    done: false,
    abort: input.abort,
    spent: input.spent,
    finished: new Promise<void>((resolve) => (settle = resolve)),
    listeners: new Set(),
    progressAt: new Map(),
  };
  registry.runs.set(key, run);
  registry.ended.delete(key);

  const wake = () => run.listeners.forEach((listener) => listener());
  const take = (chunk: UIMessageChunk) => {
    // A long tool reports its progress many times over, each report replacing the one before.
    // Only the latest is worth replaying, so the earlier ones are dropped as they are superseded.
    if (chunk.type === "tool-output-available" || chunk.type === "tool-output-error") {
      const earlier = run.progressAt.get(chunk.toolCallId);
      if (earlier !== undefined) run.chunks[earlier] = undefined;
      if (chunk.type === "tool-output-available" && chunk.preliminary) run.progressAt.set(chunk.toolCallId, run.chunks.length);
      else run.progressAt.delete(chunk.toolCallId);
    }
    run.chunks.push(chunk);
    wake();
  };

  void (async () => {
    const reader = input.stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        take(value);
      }
    } catch (err) {
      console.error("[runs] a run broke off", err);
      take({ type: "error", errorText: "Something went wrong while answering. Try again." });
    } finally {
      run.done = true;
      // The server's copy stays the one that counts for a moment, so a save from a watcher that
      // was sent before the end and arrives after it cannot put an unfinished answer back.
      registry.ended.set(key, { at: Date.now(), messages: run.latest });
      if (registry.runs.get(key) === run) registry.runs.delete(key);
      for (const [k, ended] of registry.ended) if (Date.now() - ended.at > SETTLE_MS * 10) registry.ended.delete(k);
      wake();
      settle();
    }
  })();
  return run;
}

/** Everything the run has streamed so far, then whatever it streams next, until it ends. Stopping to watch does not stop the run. */
export function follow(run: Run): ReadableStream<UIMessageChunk> {
  let next = 0;
  let leave: () => void = () => {};
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      const flush = () => {
        try {
          while (next < run.chunks.length) {
            const chunk = run.chunks[next++];
            if (chunk) controller.enqueue(chunk);
          }
          if (run.done) {
            leave();
            controller.close();
          }
        } catch {
          // The watcher has gone away.
          leave();
        }
      };
      leave = () => void run.listeners.delete(flush);
      run.listeners.add(flush);
      flush();
    },
    cancel() {
      leave();
    },
  });
}

/** Stop a run at the user's request. True when there was one to stop. */
export function stopRun(userId: string, conversationId: string): boolean {
  const run = activeRun(userId, conversationId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

/**
 * The conversation as the server holds it while a run is in progress or has only just ended, or
 * undefined when there is nothing of the kind: then what the interface sends is what is saved.
 */
export function serverCopy(userId: string, conversationId: string): unknown[] | undefined {
  const key = keyOf(userId, conversationId);
  const run = registry.runs.get(key);
  if (run && !run.done) return run.latest;
  const ended = registry.ended.get(key);
  return ended && Date.now() - ended.at < SETTLE_MS ? ended.messages : undefined;
}

/** Note where the conversation stands, for saving and for whoever saves next. */
export function noteProgress(run: Run, messages: unknown[]): void {
  run.latest = messages;
  const ended = registry.ended.get(keyOf(run.userId, run.conversationId));
  if (run.done && ended) ended.messages = messages;
}
