import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateText, jsonSchema, Output } from "ai";
import { createModel, parseModelSpec } from "@/server/agent/models";
import { costOf, tokensFromUsage, ZERO_TOKENS, addTokens, type Tokens } from "@/server/agent/pricing";
import { describeError, withRetry } from "@/server/agent/retry";
import type { JsonSchema } from "./prompts";

/**
 * Model calls for the knowledge build: every request is described by an LlmSpec, keyed by the SHA-256 of that
 * spec, and its answer is cached on disk under the key. A rerun reads the cache and costs nothing; an interrupted
 * build resumes where it stopped. Two executors share the cache: in-process (AI SDK, bounded concurrency) and
 * Modal (scripts/knowledge/modal_exec.py), which receives the same specs as raw request bodies.
 */

/** Bump to invalidate every cached answer (prompt or schema semantics changed in a way the text does not show). */
export const PROMPT_VERSION = 1;

export type Effort = "off" | "low";
export type LlmSpec = { model: string; effort: Effort; system: string; user: string; schema: JsonSchema; schemaName: string; maxOutputTokens: number };

export type CachedAnswer = {
  key: string;
  model: string;
  output: unknown;
  tokens: Tokens;
  costUsd: number | null;
  ms: number;
  at: string;
  via: "local" | "modal";
};

export function specKey(spec: LlmSpec): string {
  return createHash("sha256").update(JSON.stringify({ v: PROMPT_VERSION, ...spec })).digest("hex");
}

export class DiskCache {
  constructor(readonly dir: string) {}
  private file(key: string) {
    return path.join(this.dir, key.slice(0, 2), `${key}.json`);
  }
  has(key: string): boolean {
    return existsSync(this.file(key));
  }
  get(key: string): CachedAnswer | undefined {
    const f = this.file(key);
    if (!existsSync(f)) return undefined;
    try {
      return JSON.parse(readFileSync(f, "utf8")) as CachedAnswer;
    } catch {
      return undefined; // a torn write from an interrupted run: treat as missing
    }
  }
  put(a: CachedAnswer): void {
    const f = this.file(a.key);
    mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(a));
    renameSync(tmp, f);
  }
}

function providerOptions(model: string, effort: Effort) {
  const { provider } = parseModelSpec(model);
  if (provider === "anthropic") return { anthropic: { structuredOutputMode: "outputFormat" as const, ...(effort === "off" ? { thinking: { type: "disabled" as const } } : { effort: "low" as const }) } };
  if (provider === "openai") return { openai: { reasoningEffort: effort === "off" ? "none" : "low", strictJsonSchema: true } };
  if (provider === "google") return { google: { thinkingConfig: effort === "off" ? { thinkingBudget: 0 } : { thinkingLevel: "low" } } };
  return {};
}

/** One call through the AI SDK, with retries on rate limits and overload. */
export async function callLocal(spec: LlmSpec, key: string): Promise<CachedAnswer> {
  const { model, price } = createModel(spec.model);
  const t0 = Date.now();
  const res = await withRetry(
    () =>
      generateText({
        model,
        instructions: spec.system,
        prompt: spec.user,
        output: Output.object({ schema: jsonSchema(spec.schema), name: spec.schemaName }),
        maxOutputTokens: spec.maxOutputTokens,
        maxRetries: 0,
        providerOptions: providerOptions(spec.model, spec.effort) as never,
        abortSignal: AbortSignal.timeout(180_000),
      }),
    { deadline: Date.now() + 15 * 60_000, policy: { maxRetries: 6, baseMs: 2000, maxMs: 60_000 } },
  );
  const tokens = tokensFromUsage(res.usage);
  return { key, model: spec.model, output: res.output, tokens, costUsd: costOf(tokens, price), ms: Date.now() - t0, at: new Date().toISOString(), via: "local" };
}

export type RunStats = { calls: number; cached: number; failed: number; tokens: Tokens; costUsd: number; ms: number };

/**
 * Answer every spec, from the cache when possible, otherwise with up to `concurrency` calls in flight.
 * Failures are reported, not thrown: the next run retries exactly those.
 */
export async function runAll(
  specs: LlmSpec[],
  cache: DiskCache,
  opts: { concurrency: number; onProgress?: (done: number, total: number, s: RunStats) => void; onError?: (spec: LlmSpec, err: string) => void },
): Promise<{ answers: Map<string, CachedAnswer>; stats: RunStats }> {
  const t0 = Date.now();
  const answers = new Map<string, CachedAnswer>();
  const stats: RunStats = { calls: 0, cached: 0, failed: 0, tokens: { ...ZERO_TOKENS }, costUsd: 0, ms: 0 };
  const todo: [LlmSpec, string][] = [];
  for (const s of specs) {
    const key = specKey(s);
    const hit = cache.get(key);
    if (hit) {
      answers.set(key, hit);
      stats.cached++;
    } else todo.push([s, key]);
  }
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const [spec, key] = todo[next++];
      try {
        const a = await callLocal(spec, key);
        cache.put(a);
        answers.set(key, a);
        stats.calls++;
        stats.tokens = addTokens(stats.tokens, a.tokens);
        stats.costUsd += a.costUsd ?? 0;
      } catch (err) {
        stats.failed++;
        opts.onError?.(spec, describeError(err));
      }
      done++;
      opts.onProgress?.(done, todo.length, stats);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, todo.length) }, worker));
  stats.ms = Date.now() - t0;
  return { answers, stats };
}

/** Sum what the cached answers cost when they were made (the build report's spend figure). */
export function spendOf(answers: Iterable<CachedAnswer>): { costUsd: number; tokens: Tokens; calls: number } {
  let tokens = { ...ZERO_TOKENS };
  let costUsd = 0;
  let calls = 0;
  for (const a of answers) {
    tokens = addTokens(tokens, a.tokens);
    costUsd += a.costUsd ?? 0;
    calls++;
  }
  return { costUsd, tokens, calls };
}
