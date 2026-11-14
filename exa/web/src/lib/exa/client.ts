import "server-only";

/**
 * A thin client for the Exa API (https://exa.ai/docs).
 *
 * We call the HTTP API directly instead of the SDK so that every request body is explicit:
 * Exa changed many parameters in 2026 and the exact shape matters (see exa/reports).
 * Each call reports its cost to the run's meter, and identical read requests are cached
 * for a few minutes so a repeated demo query is instant and survives a network blip.
 */

const BASE_URL = "https://api.exa.ai";
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 300;

export type ExaMeter = {
  /** Add the cost of one Exa call. */
  addExa(costUsd: number, kind: "search" | "contents" | "agent" | "answer"): void;
};

export type ExaEntity = {
  id: string;
  type: "place" | "product" | "company" | "person" | "publication" | string;
  properties: Record<string, unknown>;
};

export type ExaResult = {
  id: string;
  url: string;
  title?: string | null;
  publishedDate?: string | null;
  author?: string | null;
  image?: string | null;
  favicon?: string | null;
  text?: string;
  highlights?: string[];
  summary?: string;
  extras?: { links?: string[]; imageLinks?: string[] };
  entities?: ExaEntity[];
};

export type ExaGrounding = {
  field: string;
  citations: Array<{ url: string; title?: string }>;
  confidence?: "low" | "medium" | "high";
};

export type ExaSearchResponse = {
  requestId?: string;
  results: ExaResult[];
  output?: { content: unknown; grounding?: ExaGrounding[] };
  costDollars?: { total?: number };
};

export type ExaSearchRequest = {
  query: string;
  /** "auto" is the balanced default (about 1s). "lite" is cache-only and rejects most options. "deep" takes 4 to 15s. */
  type?: "auto" | "lite" | "deep-lite" | "deep";
  numResults?: number;
  /** What this search is for: which pages should rank first and which facts to pull. Exa uses it to rank. */
  objective?: string;
  category?: "company" | "people" | "news" | "publication" | "personal site" | "financial report";
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  /**
   * A two-letter country code that localises results, or the user's coordinates.
   * Coordinates only matter for queries that name no place ("coffee near me").
   */
  userLocation?: string | { country?: string; latitude: number; longitude: number };
  contents?: {
    highlights?: boolean | { query?: string; maxCharacters?: number };
    text?: boolean | { maxCharacters?: number };
    /** 0 forces a live fetch, -1 is cache only. Leave unset unless stale data would be wrong. */
    maxAgeHours?: number;
    extras?: { imageLinks?: number; links?: number };
  };
  /** JSON Schema for a synthesised structured answer: at most 10 properties and 2 levels of nesting. */
  outputSchema?: Record<string, unknown>;
};

export type ExaContentsResponse = {
  results: ExaResult[];
  statuses?: Array<{ id: string; status: string; source?: string; error?: { tag?: string } }>;
  costDollars?: { total?: number };
};

export type ExaAgentRun = {
  id: string;
  status: "queued" | "pending" | "running" | "completed" | "failed" | "cancelled";
  stopReason?: string | null;
  output?: { text?: string; structured?: unknown; grounding?: ExaGrounding[] };
  costDollars?: { total?: number };
  error?: { message?: string } | string | null;
};

export class ExaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExaError";
  }
}

type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

function apiKey(): string {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new ExaError("EXA_API_KEY is not set. Add it to exa/.env.local.", 500);
  return key;
}

/**
 * Requests take turns. Exa allows ten searches a second and a hundred content fetches a second
 * for the whole key, and a research team of twelve asks for far more than that at once. A gate
 * lets at most `concurrent` requests be in flight and starts at most `perSecond` in any second;
 * the rest wait in line, in the order they came. One gate serves the whole server, because the
 * limit is the key's, not the request's.
 */
function gate(concurrent: number, perSecond: number) {
  let inFlight = 0;
  let nextStart = 0;
  const line: Array<() => void> = [];
  return async function turn<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (inFlight >= concurrent) await new Promise<void>((resolve) => line.push(resolve));
    inFlight += 1;
    try {
      const now = Date.now();
      const at = Math.max(now, nextStart);
      nextStart = at + 1000 / perSecond;
      if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
      // Whoever asked may have given up while waiting: do not spend a request on them.
      signal?.throwIfAborted();
      return await run();
    } finally {
      inFlight -= 1;
      line.shift()?.();
    }
  };
}

/** Kept a little under Exa's limits, so a retry or another server on the same key still has room. */
const searchTurn = gate(8, 8);
const contentsTurn = gate(24, 60);
const noWait = <T,>(run: () => Promise<T>) => run();

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal; timeoutMs?: number },
): Promise<T> {
  const turn = path === "/search" || path === "/answer" ? searchTurn : path === "/contents" ? contentsTurn : noWait;
  const attempt = (): Promise<Response> =>
    turn(() => {
      // The clock starts when the request is sent, not while it waits its turn.
      const timeout = AbortSignal.timeout(init.timeoutMs ?? 30_000);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return fetch(BASE_URL + path, {
        method: init.method,
        headers: { "x-api-key": apiKey(), "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal,
      });
    }, init.signal);

  let res = await attempt();
  // 429 (rate limit) and 503 (overloaded, not billed) are worth one polite retry.
  if (res.status === 429 || res.status === 503) {
    const retryAfter = Number(res.headers.get("retry-after")) || 1;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 3) * 1000));
    res = await attempt();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? message;
    } catch {
      /* keep the raw text */
    }
    if (res.status === 402) message = "Exa credits are used up for this key.";
    throw new ExaError(`Exa ${path} failed (${res.status}): ${message}`, res.status);
  }
  return (await res.json()) as T;
}

/** Web search. Results carry highlights or text when `contents` asks for them. */
export async function exaSearch(
  body: ExaSearchRequest,
  opts: { meter?: ExaMeter; signal?: AbortSignal; cache?: boolean } = {},
): Promise<ExaSearchResponse> {
  const key = "search:" + JSON.stringify(body);
  if (opts.cache !== false) {
    const hit = cacheGet<ExaSearchResponse>(key);
    if (hit) return hit;
  }
  const res = await request<ExaSearchResponse>("/search", { method: "POST", body: { type: "auto", ...body }, signal: opts.signal });
  opts.meter?.addExa(res.costDollars?.total ?? 0, "search");
  if (opts.cache !== false) cacheSet(key, res);
  return res;
}

/** Fetch page contents for known URLs. */
export async function exaContents(
  body: { urls: string[]; text?: boolean | { maxCharacters?: number }; highlights?: boolean | { query?: string }; maxAgeHours?: number },
  opts: { meter?: ExaMeter; signal?: AbortSignal; cache?: boolean } = {},
): Promise<ExaContentsResponse> {
  const key = "contents:" + JSON.stringify(body);
  if (opts.cache !== false) {
    const hit = cacheGet<ExaContentsResponse>(key);
    if (hit) return hit;
  }
  const res = await request<ExaContentsResponse>("/contents", { method: "POST", body, signal: opts.signal });
  opts.meter?.addExa(res.costDollars?.total ?? 0, "contents");
  if (opts.cache !== false) cacheSet(key, res);
  return res;
}

/**
 * Run the Exa Agent and wait for the result. Used for live partner data (Exa Connect):
 * "jinko" for flights and hotels, "polymarket", "financial_datasets", "affiliate".
 * `effort` is always set: the API default is metered and can cost dollars per run.
 */
export async function exaAgentRun(
  body: {
    query: string;
    effort?: "minimal" | "low" | "medium";
    outputSchema?: Record<string, unknown>;
    systemPrompt?: string;
    dataSources?: Array<{ provider: string }>;
  },
  opts: { meter?: ExaMeter; signal?: AbortSignal; deadlineMs?: number; onPoll?: (elapsedMs: number) => void } = {},
): Promise<ExaAgentRun> {
  const key = "agent:" + JSON.stringify(body);
  const hit = cacheGet<ExaAgentRun>(key);
  if (hit) return hit;

  const started = Date.now();
  const created = await request<ExaAgentRun>("/agent/runs", {
    method: "POST",
    body: { effort: "low", ...body },
    signal: opts.signal,
  });
  const deadline = started + (opts.deadlineMs ?? 75_000);
  let run = created;
  while (run.status === "queued" || run.status === "pending" || run.status === "running") {
    if (Date.now() > deadline) throw new ExaError("The live data lookup took too long.", 504);
    await new Promise((r) => setTimeout(r, 1200));
    opts.signal?.throwIfAborted();
    run = await request<ExaAgentRun>(`/agent/runs/${created.id}`, { method: "GET", signal: opts.signal, timeoutMs: 15_000 });
    opts.onPoll?.(Date.now() - started);
  }
  opts.meter?.addExa(run.costDollars?.total ?? 0, "agent");
  if (run.status !== "completed") {
    const message = typeof run.error === "string" ? run.error : run.error?.message;
    throw new ExaError(message ?? `The live data lookup ended with status ${run.status}.`, 502);
  }
  cacheSet(key, run);
  return run;
}
