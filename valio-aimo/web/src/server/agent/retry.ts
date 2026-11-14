import { APICallError } from "ai";

/**
 * Retries for model calls: rate limits (429), overload (529, 503) and other transient failures, with
 * exponential backoff and jitter, honouring Retry-After, and never past the run's deadline. The AI SDK's
 * own retries are switched off (maxRetries: 0) so that every retry is visible in the transcript.
 */

export type RetryPolicy = { maxRetries: number; baseMs: number; maxMs: number };
export const DEFAULT_RETRY: RetryPolicy = { maxRetries: 4, baseMs: 1000, maxMs: 20_000 };

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export function isRetryable(err: unknown): boolean {
  if (APICallError.isInstance(err)) return err.isRetryable || (err.statusCode !== undefined && RETRYABLE.has(err.statusCode));
  const code = (err as { code?: string })?.code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "UND_ERR_SOCKET";
}

function retryAfterMs(err: unknown): number | undefined {
  if (!APICallError.isInstance(err)) return undefined;
  const h = err.responseHeaders ?? {};
  const ms = Number(h["retry-after-ms"]);
  if (Number.isFinite(ms) && ms > 0) return ms;
  const s = h["retry-after"];
  if (!s) return undefined;
  const secs = Number(s);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(s);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export function describeError(err: unknown): string {
  if (APICallError.isInstance(err)) return `HTTP ${err.statusCode ?? "?"}: ${err.message.slice(0, 300)}`;
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
}

export type RetryEvent = { attempt: number; waitMs: number; error: string };

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { policy?: RetryPolicy; deadline: number; onRetry?: (e: RetryEvent) => void; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const policy = opts.policy ?? DEFAULT_RETRY;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt > policy.maxRetries || !isRetryable(err)) throw err;
      const backoff = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1));
      const waitMs = Math.round(Math.min(policy.maxMs, retryAfterMs(err) ?? backoff * (0.5 + Math.random() / 2)));
      if (Date.now() + waitMs >= opts.deadline) throw err;
      opts.onRetry?.({ attempt, waitMs, error: describeError(err) });
      await sleep(waitMs);
    }
  }
}
