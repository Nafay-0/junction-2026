import { redact } from "./redact";

/**
 * A small client for api.aiven.io: one token, a timeout, a short cache for reads, errors without secrets.
 * The showcase only ever holds read-only tokens (see config.ts).
 */
export class AivenApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const cache = new Map<string, { at: number; value: unknown }>();

export async function aivenApi<T>(token: string, method: "GET" | "POST" | "PUT", path: string, opts: { body?: unknown; timeoutMs?: number; cacheMs?: number } = {}): Promise<T> {
  const key = method === "GET" && opts.cacheMs ? `${token.slice(-6)}|${path}` : undefined;
  const hit = key ? cache.get(key) : undefined;
  if (hit && key && Date.now() - hit.at < opts.cacheMs!) return hit.value as T;
  let res: Response;
  try {
    res = await fetch(`https://api.aiven.io/v1${path}`, {
      method,
      headers: { authorization: `aivenv1 ${token}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new AivenApiError(0, redact(`Aiven API did not answer: ${err instanceof Error ? err.message : String(err)}`));
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      /* not JSON */
    }
    throw new AivenApiError(res.status, redact(`Aiven API ${res.status}: ${message}`));
  }
  const value = (text ? JSON.parse(text) : {}) as T;
  if (key) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return value;
}
